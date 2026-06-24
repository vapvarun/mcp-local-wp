import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { SiteSelectionResult } from './types.js';

const execAsync = promisify(exec);

/**
 * Resolve Local by Flywheel's bundled PHP binary.
 *
 * Local ships a matching PHP per version under lightning-services. Using it
 * (rather than a system/Homebrew PHP) avoids the extension-API mismatch that
 * makes a Homebrew PHP spew opcache/xdebug/imagick startup warnings — and, more
 * importantly, keeps the runtime consistent with how the site actually runs.
 * Override with LOCAL_PHP_BIN.
 */
function resolveLocalPhp(): string {
  if (process.env.LOCAL_PHP_BIN && fs.existsSync(process.env.LOCAL_PHP_BIN)) {
    return process.env.LOCAL_PHP_BIN;
  }
  const base = path.join(
    os.homedir(),
    'Library/Application Support/Local/lightning-services'
  );
  const platform = `${process.platform}-${process.arch}`; // e.g. darwin-arm64
  if (fs.existsSync(base)) {
    const dirs = fs
      .readdirSync(base)
      .filter((d) => d.startsWith('php-'))
      .sort()
      .reverse(); // highest version first
    for (const d of dirs) {
      const candidate = path.join(base, d, 'bin', platform, 'bin', 'php');
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return 'php';
}

/**
 * Resolve the wp-cli binary. Override with WP_CLI_BIN.
 */
function resolveWpBin(): string {
  if (process.env.WP_CLI_BIN && fs.existsSync(process.env.WP_CLI_BIN)) {
    return process.env.WP_CLI_BIN;
  }
  for (const candidate of ['/opt/homebrew/bin/wp', '/usr/local/bin/wp']) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return 'wp';
}

/**
 * Single-quote a string for safe inclusion in a `sh -c` command line.
 */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Resolve the WordPress root (the --path) for a Local site.
 *
 * Note: LocalSiteInfo.configPath is the MySQL conf path, NOT wp-config.php — so
 * derive the WP root from sitePath. Local sites are <root>/app/public; fall back
 * to the site root, then the configPath dir, picking the first that actually
 * contains wp-config.php.
 */
function resolveWpRoot(site: SiteSelectionResult): string {
  const candidates = [
    path.join(site.sitePath, 'app', 'public'),
    site.sitePath,
    path.dirname(site.siteInfo.configPath),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'wp-config.php'))) {
      return candidate;
    }
  }
  return path.join(site.sitePath, 'app', 'public');
}

export interface WpCliResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  command: string;
  site: { name: string; domain: string; socketPath: string; path: string };
}

/**
 * Run a wp-cli command against the given Local site, pinned to that site's
 * MySQL socket so the command always targets the right database.
 *
 * Why the socket pinning matters: every Local site's wp-config uses
 * DB_HOST=localhost + DB_NAME=local, so a bare `wp --path=<site>` run outside
 * Local's environment resolves `localhost` to whichever MySQL holds the default
 * socket — i.e. the WRONG site. Passing mysqli/pdo_mysql.default_socket forces
 * the correct per-site database.
 *
 * @param command The wp-cli arguments (everything after `wp`), e.g.
 *                 "plugin activate jetonomy" or "option get home".
 * @param site    The resolved Local site to target.
 */
export async function runWpCli(
  command: string,
  site: SiteSelectionResult
): Promise<WpCliResult> {
  const php = resolveLocalPhp();
  const wp = resolveWpBin();
  const socket = site.siteInfo.socketPath;
  const publicPath = resolveWpRoot(site);

  if (!fs.existsSync(socket)) {
    return {
      ok: false,
      stdout: '',
      stderr: `MySQL socket not found at ${socket} — is the site "${site.siteName}" running in Local?`,
      command: '',
      site: { name: site.siteName, domain: site.domain, socketPath: socket, path: publicPath },
    };
  }

  const full =
    `${shellQuote(php)} ` +
    `-d mysqli.default_socket=${shellQuote(socket)} ` +
    `-d pdo_mysql.default_socket=${shellQuote(socket)} ` +
    `${shellQuote(wp)} --path=${shellQuote(publicPath)} ` +
    command;

  try {
    const { stdout, stderr } = await execAsync(full, {
      maxBuffer: 32 * 1024 * 1024,
      timeout: 180000,
    });
    return {
      ok: true,
      stdout,
      stderr,
      command: full,
      site: { name: site.siteName, domain: site.domain, socketPath: socket, path: publicPath },
    };
  } catch (error: any) {
    return {
      ok: false,
      stdout: error?.stdout ?? '',
      stderr: error?.stderr ?? (error?.message || String(error)),
      command: full,
      site: { name: site.siteName, domain: site.domain, socketPath: socket, path: publicPath },
    };
  }
}
