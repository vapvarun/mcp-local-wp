import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getLocalSitePath, getLocalSocketPath } from './local-detector.js';

function debugLog(...args: any[]) {
  if (process.env.DEBUG && process.env.DEBUG.includes('mcp-local-wp')) {
    console.error('[mcp-local-wp]', ...args);
  }
}

/**
 * Execute a WP-CLI command safely using execFileSync
 */
export function executeWpCli(command: string, args: string[] = []): string {
  const sitePath = getLocalSitePath();
  const socketPath = getLocalSocketPath();

  // Set up environment with MySQL socket
  const env = {
    ...process.env,
    MYSQL_UNIX_PORT: socketPath,
  };

  // Build full args array
  const fullArgs = [command, ...args];

  debugLog('Executing WP-CLI:', 'wp', fullArgs.join(' '));

  try {
    const output = execFileSync('wp', fullArgs, {
      encoding: 'utf8',
      cwd: sitePath,
      env,
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer
    });
    return output;
  } catch (error: any) {
    if (error.stdout) {
      return error.stdout;
    }
    throw new Error(`WP-CLI error: ${error.message}`);
  }
}

/**
 * Create a WordPress post
 */
export function createPost(options: {
  post_type?: string;
  post_title: string;
  post_content?: string;
  post_status?: string;
  post_name?: string;
  post_parent?: number;
}): string {
  const args: string[] = [];

  args.push(`--post_type=${options.post_type || 'post'}`);
  args.push(`--post_title=${options.post_title}`);
  args.push(`--post_status=${options.post_status || 'publish'}`);
  args.push('--porcelain');

  if (options.post_name) {
    args.push(`--post_name=${options.post_name}`);
  }
  if (options.post_parent) {
    args.push(`--post_parent=${options.post_parent}`);
  }

  // Create the post first
  const postId = executeWpCli('post', ['create', ...args]).trim();

  // Update content separately if provided (handles complex Gutenberg blocks)
  if (options.post_content) {
    updatePostContent(parseInt(postId), options.post_content);
  }

  return postId;
}

/**
 * Update post content using a temp file (safer for complex content)
 */
export function updatePostContent(postId: number, content: string): void {
  const sitePath = getLocalSitePath();
  const socketPath = getLocalSocketPath();
  const contentFile = path.join('/tmp', `wp_content_${postId}_${Date.now()}.txt`);

  try {
    // Write content to temp file
    fs.writeFileSync(contentFile, content, 'utf8');

    // Read the content back and use it as argument
    const env = {
      ...process.env,
      MYSQL_UNIX_PORT: socketPath,
    };

    execFileSync('wp', ['post', 'update', String(postId), `--post_content=${content}`], {
      encoding: 'utf8',
      cwd: sitePath,
      env,
      maxBuffer: 50 * 1024 * 1024,
    });
  } finally {
    // Clean up temp file
    if (fs.existsSync(contentFile)) {
      fs.unlinkSync(contentFile);
    }
  }
}

/**
 * Update a WordPress post
 */
export function updatePost(postId: number, options: {
  post_title?: string;
  post_content?: string;
  post_status?: string;
  post_name?: string;
}): void {
  const args: string[] = [String(postId)];

  if (options.post_title) {
    args.push(`--post_title=${options.post_title}`);
  }
  if (options.post_status) {
    args.push(`--post_status=${options.post_status}`);
  }
  if (options.post_name) {
    args.push(`--post_name=${options.post_name}`);
  }

  // Update basic fields
  if (args.length > 1) {
    executeWpCli('post', ['update', ...args]);
  }

  // Update content separately if provided
  if (options.post_content) {
    updatePostContent(postId, options.post_content);
  }
}

/**
 * Delete a WordPress post
 */
export function deletePost(postId: number, force: boolean = false): string {
  const args = ['delete', String(postId)];
  if (force) {
    args.push('--force');
  }
  return executeWpCli('post', args);
}

/**
 * Add a menu item
 */
export function addMenuItem(options: {
  menu: string;
  post_id: number;
  title?: string;
  parent_id?: number;
}): string {
  const args = ['item', 'add-post', options.menu, String(options.post_id)];

  if (options.title) {
    args.push(`--title=${options.title}`);
  }
  if (options.parent_id) {
    args.push(`--parent-id=${options.parent_id}`);
  }

  return executeWpCli('menu', args);
}
