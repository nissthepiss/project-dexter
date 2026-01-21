// ANSI color codes for terminal styling
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  darkGrey: '\x1b[90m',
  grey: '\x1b[37m',
  orange: '\x1b[33m', // Yellow is closest to orange in terminal
};

// Get current timestamp in HH:MM:SS format
function getTimestamp() {
  const now = new Date();
  return now.toLocaleTimeString('en-US', { 
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

const logger = {
  // SUCCESS
  success: (message, ...args) => {
    const time = getTimestamp();
    console.log(
      `${colors.darkGrey}${time}${colors.reset} ${colors.grey}${message}${colors.reset}`,
      ...args
    );
  },

  // INFO
  info: (message, ...args) => {
    const time = getTimestamp();
    console.log(
      `${colors.darkGrey}${time}${colors.reset} ${colors.grey}${message}${colors.reset}`,
      ...args
    );
  },

  // WARNING
  warn: (message, ...args) => {
    const time = getTimestamp();
    console.log(
      `${colors.darkGrey}${time}${colors.reset} ${colors.grey}${message}${colors.reset}`,
      ...args
    );
  },

  // ERROR
  error: (message, error = null) => {
    const time = getTimestamp();
    console.error(
      `${colors.darkGrey}${time}${colors.reset} ${colors.grey}ERROR${colors.reset}: ${message}`
    );
    if (error) {
      if (typeof error === 'object') {
        if (error.message) {
          console.error(`  ${colors.grey}${error.message}${colors.reset}`);
        }
        if (error.stack) {
          const stackLines = error.stack.split('\n').slice(1, 4);
          stackLines.forEach(line => {
            console.error(`  ${colors.darkGrey}${line.trim()}${colors.reset}`);
          });
        }
      } else {
        console.error(`  ${colors.grey}${error}${colors.reset}`);
      }
    }
  },

  // DEBUG
  debug: (message, ...args) => {
    const time = getTimestamp();
    console.log(
      `${colors.darkGrey}${time}${colors.reset} ${colors.grey}${message}${colors.reset}`,
      ...args
    );
  },

  // STARTUP
  startup: (message, ...args) => {
    const time = getTimestamp();
    console.log(
      `${colors.darkGrey}${time}${colors.reset} ${colors.grey}${message}${colors.reset}`,
      ...args
    );
  },

  // TRACKED
  tracked: (message, ...args) => {
    const time = getTimestamp();
    console.log(
      `${colors.darkGrey}${time}${colors.reset} ${colors.grey}${message}${colors.reset}`,
      ...args
    );
  },

  // DATABASE
  database: (message, ...args) => {
    const time = getTimestamp();
    console.log(
      `${colors.darkGrey}${time}${colors.reset} ${colors.grey}${message}${colors.reset}`,
      ...args
    );
  },

  // API
  api: (message, ...args) => {
    const time = getTimestamp();
    console.log(
      `${colors.darkGrey}${time}${colors.reset} ${colors.grey}${message}${colors.reset}`,
      ...args
    );
  },

  // SECTION HEADER
  section: (title) => {
    const time = getTimestamp();
    console.log(`${colors.darkGrey}${time}${colors.reset} 🔥 ${colors.orange}${title}${colors.reset} 🔥`);
  },

  // DIVIDER
  divider: () => {
    console.log(`${colors.darkGrey}${'-'.repeat(70)}${colors.reset}`);
  },

  // Highlight a value in orange
  highlight: (text) => {
    return `${colors.orange}${text}${colors.reset}`;
  },

  // Stats table
  stats: (title, stats) => {
    console.log(`\n${title}`);
    console.log(`${colors.darkGrey}${'-'.repeat(70)}${colors.reset}`);
    
    Object.entries(stats).forEach(([key, value]) => {
      const paddedKey = String(key).padEnd(30, ' ');
      console.log(`  ${colors.grey}${paddedKey}${colors.reset} ${colors.orange}${value}${colors.reset}`);
    });
    console.log();
  },
};

export default logger;
