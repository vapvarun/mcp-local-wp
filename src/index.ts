#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { config } from 'dotenv';
import { MySQLClient } from './mysql-client.js';
import {
  getLocalMySQLConfig,
  listAvailableSites,
  switchToSite,
  detectSiteFromPath,
  getMySQLConfigForSite,
} from './local-detector.js';
import type { SiteSelectionResult } from './types.js';
import { runWpCli } from './wp-cli.js';

// Load environment variables
config();

// Check if write operations are enabled
const allowWrites = process.env.MYSQL_ALLOW_WRITES === 'true';

function debugLog(...args: any[]) {
  if (process.env.DEBUG && process.env.DEBUG.includes('mcp-local-wp')) {
    // eslint-disable-next-line no-console
    console.error('[mcp-local-wp]', ...args);
  }
}

// Store site selection for the mysql_current_site tool
let currentSiteSelection: SiteSelectionResult | undefined;

// Get MySQL configuration (will auto-detect Local by Flywheel)
let mysqlConfig;
try {
  const configResult = getLocalMySQLConfig(process.env.MYSQL_DB);
  currentSiteSelection = configResult._siteSelection;

  // Remove internal property before using as MySQLClient config
  const { _siteSelection, ...cleanConfig } = configResult;
  mysqlConfig = cleanConfig;

  // Log site selection at startup
  if (currentSiteSelection) {
    console.error(`[mcp-local-wp] Connected to site: ${currentSiteSelection.siteName}`);
    console.error(`[mcp-local-wp] Selection method: ${currentSiteSelection.selectionMethod}`);
    console.error(`[mcp-local-wp] Site path: ${currentSiteSelection.sitePath}`);
    console.error(`[mcp-local-wp] Domain: ${currentSiteSelection.domain}`);
  }
} catch (error: any) {
  console.error('Failed to detect Local by Flywheel configuration:', error.message);
  console.error('Falling back to environment variables...');

  // Fallback to environment variables
  mysqlConfig = {
    host: process.env.MYSQL_HOST || 'localhost',
    port: parseInt(process.env.MYSQL_PORT || '3306'),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASS || 'root',
    database: process.env.MYSQL_DB || 'local',
    socketPath: process.env.MYSQL_SOCKET_PATH,
    multipleStatements: false,
    timezone: 'Z',
  };
}

// Initialize MySQL client
const mysql = new MySQLClient(mysqlConfig);

// Create MCP server
const server = new Server(
  {
    name: 'mcp-local-wp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define tool schemas - keeping it simple with just mysql_query like the original
const tools: Tool[] = [
  {
    name: 'mysql_query',
    description: 'Execute a read-only SQL query against the Local WordPress database',
    inputSchema: {
      type: 'object',
      properties: {
        sql: {
          type: 'string',
          description: 'Single read-only SQL statement (SELECT/SHOW/DESCRIBE/EXPLAIN).',
        },
        params: {
          type: 'array',
          description: 'Optional parameter values for placeholders (?).',
          items: { type: 'string' },
        },
      },
      required: ['sql'],
    },
  },
  {
    name: 'mysql_schema',
    description: 'Inspect database schema. Without args: lists tables. With table: shows columns and indexes.',
    inputSchema: {
      type: 'object',
      properties: {
        table: {
          type: 'string',
          description: 'Optional table name to inspect',
        },
      },
    },
  },
  {
    name: 'mysql_current_site',
    description:
      'Get information about the currently connected Local WordPress site, including how it was selected',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'mysql_list_sites',
    description: 'List all available Local WordPress sites and their running status',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'mysql_switch_site',
    description:
      'Switch to a different Local WordPress site by name, ID, or path. Use this when you need to connect to a different site without restarting the MCP server.',
    inputSchema: {
      type: 'object',
      properties: {
        site_name: {
          type: 'string',
          description: 'Site name (e.g., "meeting", "reign-learndash")',
        },
        site_id: {
          type: 'string',
          description: 'Site ID from Local (the UUID-like identifier)',
        },
        site_path: {
          type: 'string',
          description:
            'Path to detect site from (e.g., "/Users/user/Local Sites/meeting/app/public")',
        },
      },
    },
  },
  {
    name: 'mysql_detect_from_path',
    description:
      'Detect and switch to the Local WordPress site that contains the given path. Use this to auto-detect the correct site based on the user\'s current working directory.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path to check (typically the user\'s CWD)',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'wp_cli',
    description:
      'Run a WP-CLI command against the CURRENTLY SELECTED Local site (use mysql_switch_site / mysql_detect_from_path to target a different site first). This is the write-ready path for WordPress operations: plugin activate/deactivate, option get/update, post/user create, eval, eval-file, rewrite flush, etc. It runs through Local\'s bundled PHP and pins the command to the site\'s own MySQL socket, so it always hits the correct database (a bare `wp --path=...` run outside Local resolves localhost to the wrong site, since every Local site uses DB_HOST=localhost + DB_NAME=local). Provide only the arguments after `wp`.',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description:
            'The wp-cli arguments (everything after `wp`), e.g. "plugin activate jetonomy", "option get home", "option update show_on_front page", or "eval \'echo home_url();\'". Quote inner values as you would on a shell.',
        },
      },
      required: ['command'],
    },
  },
];

// Conditionally add mysql_write tool when writes are enabled
if (allowWrites) {
  tools.push({
    name: 'mysql_write',
    description: 'Execute write operations (INSERT/UPDATE/DELETE) against the Local WordPress database. UPDATE and DELETE require parameterized WHERE clauses for safety.',
    inputSchema: {
      type: 'object',
      properties: {
        sql: {
          type: 'string',
          description: 'Single write statement (INSERT/UPDATE/DELETE). Schema operations are blocked.',
        },
        params: {
          type: 'array',
          description: 'Parameter values for placeholders (?). Required for UPDATE and DELETE.',
          items: { type: 'string' },
        },
      },
      required: ['sql'],
    },
  });
}

// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools,
  };
});


// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params || {};
  if (!args) {
    throw new Error('Arguments are missing');
  }

  try {
    await mysql.connect();

    switch (name) {
      case 'mysql_query': {
        const sql = String(args.sql);
        const params = Array.isArray(args.params) ? args.params : undefined;
        debugLog('Executing mysql_query');
        const result = await mysql.executeReadOnlyQuery(sql, params);
        return {
          content: [
            { type: 'text', text: JSON.stringify(result, null, 2) },
          ],
        };
      }
      case 'mysql_schema': {
        const table = args.table as string | undefined;
        if (!table) {
          const tables = await mysql.listTables();
          return { content: [{ type: 'text', text: JSON.stringify(tables, null, 2) }] };
        }
        const [columns, indexes] = await Promise.all([
          mysql.getTableColumns(table),
          mysql.getTableIndexes(table),
        ]);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ table, columns, indexes }, null, 2),
            },
          ],
        };
      }
      case 'mysql_write': {
        if (!allowWrites) {
          throw new Error('Write operations are disabled. Set MYSQL_ALLOW_WRITES=true to enable.');
        }
        const sql = String(args.sql);
        const params = Array.isArray(args.params) ? args.params : undefined;
        debugLog('Executing mysql_write');
        const result = await mysql.executeWriteQuery(sql, params);
        return {
          content: [
            { type: 'text', text: JSON.stringify(result, null, 2) },
          ],
        };
      }

      case 'wp_cli': {
        if (!currentSiteSelection) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  { ok: false, error: 'No Local site is currently selected. Use mysql_switch_site or mysql_detect_from_path first.' },
                  null,
                  2
                ),
              },
            ],
          };
        }
        const command = String(args.command);
        debugLog('Executing wp_cli:', command);
        const result = await runWpCli(command, currentSiteSelection);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'mysql_current_site': {
        if (!currentSiteSelection) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    error: 'No site selection information available',
                    note: 'Using environment variables or default configuration',
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  siteName: currentSiteSelection.siteName,
                  siteId: currentSiteSelection.siteInfo.siteId,
                  sitePath: currentSiteSelection.sitePath,
                  domain: currentSiteSelection.domain,
                  selectionMethod: currentSiteSelection.selectionMethod,
                  socketPath: currentSiteSelection.siteInfo.socketPath,
                  port: currentSiteSelection.siteInfo.port,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'mysql_list_sites': {
        try {
          const sites = listAvailableSites();
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    sites,
                    currentSiteId: currentSiteSelection?.siteInfo.siteId || null,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (listError: unknown) {
          const message = listError instanceof Error ? listError.message : String(listError);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    error: 'Failed to list sites',
                    message,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }
      }

      case 'mysql_switch_site': {
        const siteName = args.site_name as string | undefined;
        const siteId = args.site_id as string | undefined;
        const sitePath = args.site_path as string | undefined;

        debugLog('mysql_switch_site called:', { siteName, siteId, sitePath });

        const result = switchToSite(
          { siteName, siteId, sitePath },
          currentSiteSelection
        );

        if (!result.success || !result.newSite) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: false,
                    error: result.error,
                    currentSite: currentSiteSelection
                      ? {
                          siteName: currentSiteSelection.siteName,
                          siteId: currentSiteSelection.siteInfo.siteId,
                        }
                      : null,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        // Reconnect MySQL client with new site config
        const newConfig = getMySQLConfigForSite(result.newSite, process.env.MYSQL_DB);
        await mysql.reconnect(newConfig);

        // Update current site selection
        const previousSite = currentSiteSelection;
        currentSiteSelection = result.newSite;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  previousSite: previousSite
                    ? {
                        siteName: previousSite.siteName,
                        siteId: previousSite.siteInfo.siteId,
                        domain: previousSite.domain,
                      }
                    : null,
                  newSite: {
                    siteName: result.newSite.siteName,
                    siteId: result.newSite.siteInfo.siteId,
                    sitePath: result.newSite.sitePath,
                    domain: result.newSite.domain,
                    socketPath: result.newSite.siteInfo.socketPath,
                    selectionMethod: result.newSite.selectionMethod,
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'mysql_detect_from_path': {
        const targetPath = args.path as string;

        if (!targetPath) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: false,
                    error: 'path parameter is required',
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        debugLog('mysql_detect_from_path called:', { path: targetPath });

        try {
          const detected = detectSiteFromPath(targetPath);

          // Check if we're already connected to this site
          if (
            currentSiteSelection &&
            currentSiteSelection.siteInfo.siteId === detected.siteInfo.siteId
          ) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      success: true,
                      alreadyConnected: true,
                      site: {
                        siteName: detected.siteName,
                        siteId: detected.siteInfo.siteId,
                        sitePath: detected.sitePath,
                        domain: detected.domain,
                      },
                      message: 'Already connected to the detected site',
                    },
                    null,
                    2
                  ),
                },
              ],
            };
          }

          // Switch to the detected site
          const newConfig = getMySQLConfigForSite(detected, process.env.MYSQL_DB);
          await mysql.reconnect(newConfig);

          const previousSite = currentSiteSelection;
          currentSiteSelection = detected;

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: true,
                    switched: true,
                    previousSite: previousSite
                      ? {
                          siteName: previousSite.siteName,
                          siteId: previousSite.siteInfo.siteId,
                        }
                      : null,
                    newSite: {
                      siteName: detected.siteName,
                      siteId: detected.siteInfo.siteId,
                      sitePath: detected.sitePath,
                      domain: detected.domain,
                      socketPath: detected.siteInfo.socketPath,
                    },
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (detectError: unknown) {
          const message =
            detectError instanceof Error ? detectError.message : String(detectError);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: false,
                    error: message,
                    currentSite: currentSiteSelection
                      ? {
                          siteName: currentSiteSelection.siteName,
                          siteId: currentSiteSelection.siteInfo.siteId,
                        }
                      : null,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`,
        },
      ],
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('WordPress Local MCP Server running...');
}

// Cleanup on exit
process.on('SIGINT', async () => {
  await mysql.disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await mysql.disconnect();
  process.exit(0);
});

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
