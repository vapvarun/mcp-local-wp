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
import { getLocalMySQLConfig } from './local-detector.js';
import {
  executeWpCli,
  createPost,
  updatePost,
  deletePost,
  addMenuItem,
} from './wp-cli.js';

// Load environment variables
config();

function debugLog(...args: any[]) {
  if (process.env.DEBUG && process.env.DEBUG.includes('mcp-local-wp')) {
    // eslint-disable-next-line no-console
    console.error('[mcp-local-wp]', ...args);
  }
}

// Get MySQL configuration (will auto-detect Local by Flywheel)
let mysqlConfig;
try {
  mysqlConfig = getLocalMySQLConfig(process.env.MYSQL_DB);
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

// Define tool schemas
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
    name: 'wp_cli',
    description: 'Execute a WP-CLI command on the Local WordPress site. Automatically handles the MySQL socket connection.',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'WP-CLI command to execute (without "wp" prefix). Example: "post list --post_type=page"',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'wp_post_create',
    description: 'Create a new WordPress post or page',
    inputSchema: {
      type: 'object',
      properties: {
        post_type: {
          type: 'string',
          description: 'Post type (post, page, or custom post type)',
          default: 'post',
        },
        post_title: {
          type: 'string',
          description: 'Post title',
        },
        post_content: {
          type: 'string',
          description: 'Post content (supports Gutenberg blocks)',
        },
        post_status: {
          type: 'string',
          description: 'Post status (publish, draft, pending, private)',
          default: 'publish',
        },
        post_name: {
          type: 'string',
          description: 'Post slug (URL-friendly name)',
        },
        post_parent: {
          type: 'number',
          description: 'Parent post ID (for hierarchical post types)',
        },
      },
      required: ['post_title'],
    },
  },
  {
    name: 'wp_post_update',
    description: 'Update an existing WordPress post or page',
    inputSchema: {
      type: 'object',
      properties: {
        post_id: {
          type: 'number',
          description: 'ID of the post to update',
        },
        post_title: {
          type: 'string',
          description: 'New post title',
        },
        post_content: {
          type: 'string',
          description: 'New post content',
        },
        post_status: {
          type: 'string',
          description: 'New post status',
        },
        post_name: {
          type: 'string',
          description: 'New post slug',
        },
      },
      required: ['post_id'],
    },
  },
  {
    name: 'wp_post_delete',
    description: 'Delete a WordPress post or page',
    inputSchema: {
      type: 'object',
      properties: {
        post_id: {
          type: 'number',
          description: 'ID of the post to delete',
        },
        force: {
          type: 'boolean',
          description: 'Skip trash and permanently delete',
          default: false,
        },
      },
      required: ['post_id'],
    },
  },
  {
    name: 'wp_menu_item_add',
    description: 'Add an item to a WordPress navigation menu',
    inputSchema: {
      type: 'object',
      properties: {
        menu: {
          type: 'string',
          description: 'Menu name or ID',
        },
        post_id: {
          type: 'number',
          description: 'Post/page ID to add to menu',
        },
        title: {
          type: 'string',
          description: 'Menu item title (optional, uses post title if not provided)',
        },
        parent_id: {
          type: 'number',
          description: 'Parent menu item ID for submenus',
        },
      },
      required: ['menu', 'post_id'],
    },
  },
];

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
    switch (name) {
      case 'mysql_query': {
        await mysql.connect();
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
        await mysql.connect();
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

      case 'wp_cli': {
        const command = String(args.command);
        // Parse the command into parts
        const parts = command.split(/\s+/);
        const mainCmd = parts[0];
        const cmdArgs = parts.slice(1);
        debugLog('Executing wp_cli:', mainCmd, cmdArgs);
        const output = executeWpCli(mainCmd, cmdArgs);
        return {
          content: [{ type: 'text', text: output }],
        };
      }

      case 'wp_post_create': {
        const postId = createPost({
          post_type: args.post_type as string | undefined,
          post_title: String(args.post_title),
          post_content: args.post_content as string | undefined,
          post_status: args.post_status as string | undefined,
          post_name: args.post_name as string | undefined,
          post_parent: args.post_parent as number | undefined,
        });
        return {
          content: [{ type: 'text', text: `Success: Created post ${postId}` }],
        };
      }

      case 'wp_post_update': {
        const postId = Number(args.post_id);
        updatePost(postId, {
          post_title: args.post_title as string | undefined,
          post_content: args.post_content as string | undefined,
          post_status: args.post_status as string | undefined,
          post_name: args.post_name as string | undefined,
        });
        return {
          content: [{ type: 'text', text: `Success: Updated post ${postId}` }],
        };
      }

      case 'wp_post_delete': {
        const postId = Number(args.post_id);
        const force = Boolean(args.force);
        const output = deletePost(postId, force);
        return {
          content: [{ type: 'text', text: output }],
        };
      }

      case 'wp_menu_item_add': {
        const output = addMenuItem({
          menu: String(args.menu),
          post_id: Number(args.post_id),
          title: args.title as string | undefined,
          parent_id: args.parent_id as number | undefined,
        });
        return {
          content: [{ type: 'text', text: output }],
        };
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
