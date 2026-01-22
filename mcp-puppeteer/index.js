#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import puppeteer from 'puppeteer';

// Browser instance
let browser = null;
let page = null;

// MCP Server
const server = new Server(
  {
    name: 'puppeteer-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'puppeteer_navigate',
        description: 'Navigate to a URL in the browser',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The URL to navigate to',
            },
          },
          required: ['url'],
        },
      },
      {
        name: 'puppeteer_screenshot',
        description: 'Take a screenshot of the current page',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Path to save the screenshot (optional)',
            },
          },
        },
      },
      {
        name: 'puppeteer_click',
        description: 'Click an element on the page using CSS selector',
        inputSchema: {
          type: 'object',
          properties: {
            selector: {
              type: 'string',
              description: 'CSS selector of the element to click',
            },
          },
          required: ['selector'],
        },
      },
      {
        name: 'puppeteer_fill',
        description: 'Fill a form field with text',
        inputSchema: {
          type: 'object',
          properties: {
            selector: {
              type: 'string',
              description: 'CSS selector of the input field',
            },
            text: {
              type: 'string',
              description: 'Text to fill in the field',
            },
          },
          required: ['selector', 'text'],
        },
      },
      {
        name: 'puppeteer_evaluate',
        description: 'Execute JavaScript in the browser context',
        inputSchema: {
          type: 'object',
          properties: {
            script: {
              type: 'string',
              description: 'JavaScript code to execute',
            },
          },
          required: ['script'],
        },
      },
      {
        name: 'puppeteer_content',
        description: 'Get the text content of the current page',
        inputSchema: {
          type: 'object',
          properties: {
            selector: {
              type: 'string',
              description: 'CSS selector to get content from (optional, defaults to full page)',
            },
          },
        },
      },
      {
        name: 'puppeteer_html',
        description: 'Get the HTML content of the current page',
        inputSchema: {
          type: 'object',
          properties: {
            selector: {
              type: 'string',
              description: 'CSS selector to get HTML from (optional, defaults to full page)',
            },
          },
        },
      },
      {
        name: 'puppeteer_wait',
        description: 'Wait for a selector to appear or wait for a fixed time',
        inputSchema: {
          type: 'object',
          properties: {
            selector: {
              type: 'string',
              description: 'CSS selector to wait for (optional)',
            },
            timeout: {
              type: 'number',
              description: 'Timeout in milliseconds (default: 30000)',
            },
          },
        },
      },
      {
        name: 'puppeteer_close',
        description: 'Close the browser',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ],
  };
});

// Ensure browser is initialized
async function ensureBrowser() {
  if (!browser || !browser.connected) {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    page = await browser.newPage();
    page.setDefaultTimeout(30000);
  }
  return page;
}

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const page = await ensureBrowser();

    switch (name) {
      case 'puppeteer_navigate': {
        await page.goto(args.url, { waitUntil: 'networkidle2' });
        return {
          content: [
            {
              type: 'text',
              text: `Navigated to: ${args.url}`,
            },
          ],
        };
      }

      case 'puppeteer_screenshot': {
        const screenshot = await page.screenshot({
          encoding: 'base64',
          fullPage: false,
        });
        return {
          content: [
            {
              type: 'image',
              data: screenshot,
              mimeType: 'image/png',
            },
            {
              type: 'text',
              text: 'Screenshot taken',
            },
          ],
        };
      }

      case 'puppeteer_click': {
        await page.click(args.selector);
        return {
          content: [
            {
              type: 'text',
              text: `Clicked element: ${args.selector}`,
            },
          ],
        };
      }

      case 'puppeteer_fill': {
        await page.fill(args.selector, args.text);
        return {
          content: [
            {
              type: 'text',
              text: `Filled ${args.selector} with: ${args.text}`,
            },
          ],
        };
      }

      case 'puppeteer_evaluate': {
        const result = await page.evaluate(args.script);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'puppeteer_content': {
        let content;
        if (args.selector) {
          const element = await page.locator(args.selector);
          content = await element.allTextContents();
        } else {
          content = await page.textContent('body');
        }
        return {
          content: [
            {
              type: 'text',
              text: typeof content === 'string' ? content : content.join('\n'),
            },
          ],
        };
      }

      case 'puppeteer_html': {
        let html;
        if (args.selector) {
          html = await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            return el ? el.outerHTML : null;
          }, args.selector);
        } else {
          html = await page.content();
        }
        return {
          content: [
            {
              type: 'text',
              text: html,
            },
          ],
        };
      }

      case 'puppeteer_wait': {
        if (args.selector) {
          await page.waitForSelector(args.selector, { timeout: args.timeout || 30000 });
        } else {
          await page.waitForTimeout(args.timeout || 1000);
        }
        return {
          content: [
            {
              type: 'text',
              text: args.selector ? `Waited for selector: ${args.selector}` : `Waited ${args.timeout || 1000}ms`,
            },
          ],
        };
      }

      case 'puppeteer_close': {
        if (browser && browser.connected) {
          await browser.close();
          browser = null;
          page = null;
        }
        return {
          content: [
            {
              type: 'text',
              text: 'Browser closed',
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

// Cleanup on exit
process.on('SIGINT', async () => {
  if (browser && browser.connected) {
    await browser.close();
  }
  process.exit(0);
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
