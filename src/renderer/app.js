// Detect environment: Electron (local) or Web (hosted)
// Preload script exposes window.electron.isElectron
const isElectron = window.electron && window.electron.isElectron;
const API_BASE = isElectron
  ? 'http://localhost:3001/api'           // Electron: connect to local backend
  : `${window.location.origin}/api`;      // Web: connect to same-origin backend

let currentTopTokens = [];
let currentTierInfo = { tier1: 1.1, tier2: 1.2, tier3: 1.3 };
let currentViewMode = 'all-time';
let currentMode = 'degen'; // 'degen' or 'holder'
let lastRenderedData = null;
let currentSortBy = null;
let currentSortState = 'default'; // 'default', 'desc', 'asc'
let previousTokenData = {};
let currentMVP = null;
let lastRenderedMVP = null;
let currentHolderMVP = null;
let degenTokenAddresses = new Set();
let holderTokenAddresses = new Set();
let announcedTokenAddresses = new Set();

// Notification terminal state
let terminalMessages = [];
const MAX_TERMINAL_MESSAGES = 10;

// Alert spam prevention - track last alert type and value per token
let tokenAlertHistory = new Map(); // tokenKey -> { type: string, value: number, timestamp: number }

// Track tokens we've ever seen (persists across entire session, not just when in list)
let everSeenTokens = new Set();

// Track tokens that have hit the 100% floor (to prevent re-alerting until recovery)
let floorAlertedTokens = new Set();
// Track tokens that have hit 3x (one-time alert to prevent spam)
let threeXAlertedTokens = new Set();
// Track tokens that have hit score milestones (one-time alert per milestone to prevent spam)
let milestone5AlertedTokens = new Set();
let milestone10AlertedTokens = new Set();
let milestone15AlertedTokens = new Set();

class DexterApp {
  constructor() {
    this.tokenContainer = document.getElementById('token-list');
    this.mvpContainer = document.getElementById('mvp-content');
    this.tierValues = { tier1: 1.1, tier2: 1.2, tier3: 1.3 };
    // Load persisted alerted tokens from localStorage
    const savedAlertedTokens = localStorage.getItem('dexterAlertedTokens');
    this.alertedTokens = savedAlertedTokens ? new Set(JSON.parse(savedAlertedTokens)) : new Set();
    this.tier3AlertedTokens = new Set();
    this.isFirstFetch = true;
    this.tier1AlertSound = new Audio('../../assets/alert.mp3');

    // Cache for extracted token colors (URL -> { glow, overlay, border })
    this.tokenColorCache = new Map();

    // Load cached colors from localStorage
    const savedColors = localStorage.getItem('dexterTokenColors');
    if (savedColors) {
      try {
        const parsed = JSON.parse(savedColors);
        Object.entries(parsed).forEach(([url, colors]) => {
          this.tokenColorCache.set(url, colors);
        });
      } catch (e) {
        console.warn('Failed to load token color cache:', e);
      }
    }

    // Global alert cooldown system
    this.GLOBAL_ALERT_COOLDOWN = 3000; // 3 seconds between ANY alerts
    this.lastAlertTime = 0;
    this.pendingAlertCount = 0;
    this.pendingAlertTimer = null;

    const savedVolume = localStorage.getItem('dexterAlertVolume');
    this.alertVolume = savedVolume !== null ? parseInt(savedVolume) : 70;
    this.tier1AlertSound.volume = this.alertVolume / 100;

    const savedTelegramAutoAlert = localStorage.getItem('telegramAutoAlert');
    this.telegramAutoAlert = savedTelegramAutoAlert !== null ? savedTelegramAutoAlert === 'true' : false;

    const savedPublicChannels = localStorage.getItem('publicChannelsEnabled');
    this.publicChannelsEnabled = savedPublicChannels !== null ? savedPublicChannels === 'true' : false;

    this.setupEventListeners();
    this.setupVolumeControl();
    this.setupTelegramAutoAlert();
    this.setupPublicChannels();
    this.setupDraggableTerminal();
    this.setupWindowControls();

    // Initialize body data-mode attribute for color theming
    document.body.setAttribute('data-mode', currentMode);

    this.initializeDexScreener();
    this.initializeBackendViewMode();
    this.startPolling();
  }

  playTier1Alert(batchCount = 1) {
    if (this.alertVolume === 0) return;

    const now = Date.now();
    const timeSinceLastAlert = now - this.lastAlertTime;

    // If we're within cooldown, queue the alert
    if (timeSinceLastAlert < this.GLOBAL_ALERT_COOLDOWN) {
      this.pendingAlertCount += batchCount;

      // Clear existing timer if any
      if (this.pendingAlertTimer) {
        clearTimeout(this.pendingAlertTimer);
      }

      // Schedule alert for after cooldown
      const cooldownRemaining = this.GLOBAL_ALERT_COOLDOWN - timeSinceLastAlert;
      this.pendingAlertTimer = setTimeout(() => {
        this.playTier1Alert(this.pendingAlertCount);
        this.pendingAlertCount = 0;
        this.pendingAlertTimer = null;
      }, cooldownRemaining);

      return;
    }

    // Play the alert
    this.tier1AlertSound.currentTime = 0;
    this.tier1AlertSound.play().catch(err => {
      console.warn('Could not play alert sound:', err);
    });

    this.lastAlertTime = now;

    // Show batch count in terminal if more than 1
    if (batchCount > 1) {
      this.addTerminalMessage(`⚠️ ${batchCount} tokens hit Tier 1!`, 'warning');
    }
  }

  saveAlertedTokens() {
    localStorage.setItem('dexterAlertedTokens', JSON.stringify(Array.from(this.alertedTokens)));
  }

  setupDraggableTerminal() {
    const terminal = document.getElementById('notification-terminal');
    const dragHandle = document.getElementById('terminal-drag-handle');
    const resizeHandles = document.querySelectorAll('.terminal-resize-handle');

    if (!terminal || !dragHandle) return;

    // Store original parent for reset (as instance variable)
    this.terminalOriginalParent = terminal.parentElement;

    // Drag state
    let isDragging = false;
    let dragOffsetX = 0;
    let dragOffsetY = 0;

    // Resize state
    let isResizing = false;
    let resizeDir = '';
    let startX = 0;
    let startY = 0;
    let startWidth = 0;
    let startHeight = 0;
    let startLeft = 0;
    let startTop = 0;

    // Convert to absolute positioning when first drag/resize starts
    const makeAbsolute = () => {
      if (terminal.style.position === 'absolute') return;

      const rect = terminal.getBoundingClientRect();
      const width = Math.max(rect.width, 300);
      const height = Math.max(rect.height, 150);

      // Move to body to avoid parent layout interference
      document.body.appendChild(terminal);

      // Use CSS.setProperty with priority to ensure styles can't be overridden
      terminal.style.setProperty('position', 'absolute', 'important');
      terminal.style.setProperty('width', `${width}px`, 'important');
      terminal.style.setProperty('height', `${height}px`, 'important');
      terminal.style.setProperty('left', `${rect.left}px`, 'important');
      terminal.style.setProperty('top', `${rect.top}px`, 'important');
      terminal.style.setProperty('right', 'auto', 'important');
      terminal.style.setProperty('min-height', '150px', 'important');
      terminal.classList.add('dragging');
    };

    // Load saved state - only if user previously moved it
    const savedState = localStorage.getItem('terminalState');
    if (savedState) {
      try {
        const state = JSON.parse(savedState);
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // Only restore if we have a saved position (user moved it before)
        if (state.x !== undefined && state.y !== undefined) {
          makeAbsolute();

          let newX = Math.max(0, Math.min(state.x, viewportWidth - 384));
          let newY = Math.max(0, Math.min(state.y, viewportHeight - 200));

          if (state.width) {
            terminal.style.width = `${Math.max(300, Math.min(state.width, viewportWidth - 40))}px`;
          }
          if (state.height) {
            terminal.style.height = `${Math.max(150, Math.min(state.height, viewportHeight - 40))}px`;
          }

          terminal.style.left = `${newX}px`;
          terminal.style.top = `${newY}px`;
        }
      } catch (e) {
        console.warn('Could not restore terminal state:', e);
      }
    }

    // DRAG FUNCTIONALITY
    dragHandle.addEventListener('mousedown', (e) => {
      makeAbsolute();

      isDragging = true;
      const rect = terminal.getBoundingClientRect();
      dragOffsetX = e.clientX - rect.left;
      dragOffsetY = e.clientY - rect.top;

      terminal.style.transition = 'none';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    // RESIZE FUNCTIONALITY
    resizeHandles.forEach(handle => {
      handle.addEventListener('mousedown', (e) => {
        makeAbsolute();

        isResizing = true;
        resizeDir = handle.getAttribute('data-dir');
        startX = e.clientX;
        startY = e.clientY;

        const rect = terminal.getBoundingClientRect();
        startWidth = rect.width;
        startHeight = rect.height;
        startLeft = rect.left;
        startTop = rect.top;

        terminal.style.transition = 'none';
        document.body.style.userSelect = 'none';
        e.preventDefault();
        e.stopPropagation();
      });
    });

    // Combined mousemove handler
    document.addEventListener('mousemove', (e) => {
      if (isDragging) {
        // Handle dragging
        let newX = e.clientX - dragOffsetX;
        let newY = e.clientY - dragOffsetY;

        // Constrain to viewport
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const terminalRect = terminal.getBoundingClientRect();

        newX = Math.max(0, Math.min(newX, viewportWidth - terminalRect.width));
        newY = Math.max(0, Math.min(newY, viewportHeight - terminalRect.height));

        terminal.style.left = `${newX}px`;
        terminal.style.top = `${newY}px`;
      } else if (isResizing) {
        // Handle resizing
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        let newWidth = startWidth;
        let newHeight = startHeight;
        let newLeft = startLeft;
        let newTop = startTop;

        // Minimum dimensions
        const minWidth = 300;
        const minHeight = 150;

        if (resizeDir.includes('e')) {
          newWidth = Math.max(minWidth, Math.min(startWidth + dx, viewportWidth - startLeft - 10));
        }
        if (resizeDir.includes('w')) {
          const maxDelta = startWidth - minWidth;
          const validDelta = Math.min(dx, maxDelta);
          newWidth = startWidth - validDelta;
          newLeft = startLeft + validDelta;
        }
        if (resizeDir.includes('s')) {
          newHeight = Math.max(minHeight, Math.min(startHeight + dy, viewportHeight - startTop - 10));
        }
        if (resizeDir.includes('n')) {
          const maxDelta = startHeight - minHeight;
          const validDelta = Math.min(dy, maxDelta);
          newHeight = startHeight - validDelta;
          newTop = startTop + validDelta;
        }

        terminal.style.width = `${newWidth}px`;
        terminal.style.height = `${newHeight}px`;
        terminal.style.left = `${newLeft}px`;
        terminal.style.top = `${newTop}px`;
      }
    });

    // Combined mouseup handler
    document.addEventListener('mouseup', () => {
      if (isDragging || isResizing) {
        isDragging = false;
        isResizing = false;
        terminal.style.transition = '';
        document.body.style.userSelect = '';

        // Save state only if terminal is absolute (user moved it)
        if (terminal.style.position === 'absolute') {
          const rect = terminal.getBoundingClientRect();
          localStorage.setItem('terminalState', JSON.stringify({
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height
          }));
        }
      }
    });

    // Handle window resize to keep terminal in view
    window.addEventListener('resize', () => {
      // Only handle if terminal is absolutely positioned
      if (terminal.style.position !== 'absolute') return;

      const rect = terminal.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let newX = rect.left;
      let newY = rect.top;
      let newWidth = rect.width;
      let newHeight = rect.height;

      // Adjust if out of bounds
      if (rect.right > viewportWidth) {
        newX = Math.max(0, viewportWidth - rect.width);
      }
      if (rect.bottom > viewportHeight) {
        newY = Math.max(0, viewportHeight - rect.height);
      }
      if (rect.left < 0) newX = 0;
      if (rect.top < 0) newY = 0;

      // Adjust width/height if too big
      if (rect.width > viewportWidth - 20) {
        newWidth = viewportWidth - 20;
      }
      if (rect.height > viewportHeight - 20) {
        newHeight = viewportHeight - 20;
      }

      terminal.style.left = `${newX}px`;
      terminal.style.top = `${newY}px`;
      if (newWidth !== rect.width) terminal.style.width = `${newWidth}px`;
      if (newHeight !== rect.height) terminal.style.height = `${newHeight}px`;
    });
  }

  resetTerminalPosition() {
    const terminal = document.getElementById('notification-terminal');
    if (!terminal) return;

    // Clear saved state from localStorage
    localStorage.removeItem('terminalState');

    // Move back to original parent
    if (this.terminalOriginalParent) {
      this.terminalOriginalParent.appendChild(terminal);
    }

    // Clear all inline styles
    terminal.style.position = '';
    terminal.style.width = '';
    terminal.style.height = '';
    terminal.style.left = '';
    terminal.style.top = '';
    terminal.style.right = '';
    terminal.style.minHeight = '';
    terminal.classList.remove('dragging');

    // Show confirmation message
    this.addTerminalMessage('Terminal position reset to default', 'success');
  }

  addTerminalMessage(text, type = 'info', tokenData = null) {
    const terminalMessagesEl = document.getElementById('terminal-messages');
    if (!terminalMessagesEl) return;

    const now = new Date();
    const timestamp = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;

    // Create the new message element
    const newMessage = { text, type, timestamp, tokenData };

    // Add message to array
    terminalMessages.push(newMessage);
    if (terminalMessages.length > MAX_TERMINAL_MESSAGES) {
      terminalMessages.shift();
      // If we shifted, we need to re-render to remove the oldest message
      terminalMessagesEl.innerHTML = '';
      terminalMessages.forEach(msg => {
        terminalMessagesEl.appendChild(this.createMessageElement(msg));
      });
    } else {
      // Only append the new message (no full re-render)
      terminalMessagesEl.appendChild(this.createMessageElement(newMessage));
    }

    // Auto-scroll to bottom
    terminalMessagesEl.scrollTop = terminalMessagesEl.scrollHeight;
  }

  createMessageElement(msg) {
    const div = document.createElement('div');
    div.className = `terminal-message terminal-message-${msg.type}`;

    if (msg.tokenData) {
      const { symbol, contractAddress, imageUrl } = msg.tokenData;
      const iconHtml = imageUrl
        ? `<img src="${imageUrl}" class="message-token-icon" onerror="this.style.display='none'">`
        : `<span class="message-token-icon">${symbol ? symbol[0] : '?'}</span>`;
      const tickerHtml = symbol
        ? `<span class="message-ticker" data-ca="${contractAddress}" title="Click to copy CA">${symbol}</span>`
        : '';
      const textWithTicker = msg.text.replace(symbol, tickerHtml);

      div.innerHTML = `
        <span class="message-timestamp">${msg.timestamp}</span>
        ${iconHtml}
        <span class="message-text">${textWithTicker}</span>
      `;
    } else {
      div.innerHTML = `
        <span class="message-timestamp">${msg.timestamp}</span>
        <span class="message-text">${msg.text}</span>
      `;
    }

    // Setup click listener for ticker if present
    const ticker = div.querySelector('.message-ticker');
    if (ticker) {
      ticker.addEventListener('click', async () => {
        const ca = ticker.getAttribute('data-ca');
        if (ca) {
          try {
            // Try modern clipboard API first
            await navigator.clipboard.writeText(ca);
            ticker.style.color = 'var(--status-green)';
            setTimeout(() => {
              ticker.style.color = '';
            }, 500);
          } catch (err) {
            // Fallback to older method
            try {
              const textArea = document.createElement('textarea');
              textArea.value = ca;
              textArea.style.position = 'fixed';
              textArea.style.left = '-999999px';
              textArea.style.top = '-999999px';
              document.body.appendChild(textArea);
              textArea.focus();
              textArea.select();
              document.execCommand('copy');
              document.body.removeChild(textArea);
              ticker.style.color = 'var(--status-green)';
              setTimeout(() => {
                ticker.style.color = '';
              }, 500);
            } catch (fallbackErr) {
              console.error('Failed to copy CA:', fallbackErr);
              ticker.style.color = 'var(--status-red)';
              setTimeout(() => {
                ticker.style.color = '';
              }, 500);
            }
          }
        }
      });
    }

    return div;
  }

  checkForTokenEvents(tokens) {
    if (!tokens || !Array.isArray(tokens)) return;

    const currentAddresses = new Set(tokens.map(t => t.tokenAddress || t.address));
    const now = Date.now();
    const ALERT_COOLDOWN = 10000; // 10 seconds between same alert type for same token
    const DIP_COOLDOWN = 300000; // 5 minutes between dip alerts for same token (prevent spam)
    const RAPID_GAIN_COOLDOWN = 60000; // 60 seconds for "rapidly" alerts (longer to prevent spam)
    const RAPID_GAIN_MIN_SCORE = 8; // Only alert "rapidly" for tokens with score >= 8

    // Helper to check if we should fire alert (spam prevention)
    const shouldAlert = (tokenKey, alertType, value) => {
      const history = tokenAlertHistory.get(tokenKey);
      if (!history) return true;

      // Different alert type - allow it
      if (history.type !== alertType) return true;

      // Same alert type - check cooldown
      const timeSinceLastAlert = now - history.timestamp;
      let cooldownTime = ALERT_COOLDOWN;

      // Use specific cooldowns for certain alert types
      if (alertType === 'dip') {
        cooldownTime = DIP_COOLDOWN;
      } else if (alertType === 'rapid_gain') {
        cooldownTime = RAPID_GAIN_COOLDOWN;
      }

      if (timeSinceLastAlert < cooldownTime) {
        // STRICT cooldown for dip alerts (no exceptions)
        if (alertType === 'dip') {
          return false;
        }
        // For other alert types, allow if value changed significantly (20%+)
        if (value && history.value && Math.abs((value - history.value) / history.value) > 0.2) {
          return true;
        }
        return false;
      }
      return true;
    };

    // Helper to record that we fired an alert
    const recordAlert = (tokenKey, alertType, value) => {
      tokenAlertHistory.set(tokenKey, { type: alertType, value, timestamp: now });
    };

    // Check for new tokens entering the list
    const previousAddresses = new Set(Object.keys(previousTokenData));

    // Track rank changes for "rising fast" alert
    const currentRanks = new Map();
    tokens.forEach((token, index) => {
      const tokenKey = token.tokenAddress || token.address;
      currentRanks.set(tokenKey, index + 1);
    });

    // Track network activity
    let tokensMovingFast = 0;
    let tokensGainingPoints = 0;

    tokens.forEach((token, currentIndex) => {
      const tokenKey = token.tokenAddress || token.address;
      const currentRank = currentIndex + 1;
      const isNew = !previousAddresses.has(tokenKey);

      const prevData = previousTokenData[tokenKey];

      if (!prevData) {
        previousTokenData[tokenKey] = {
          score: token.score || 0,
          volume: token.volume || 0,
          spotted: token.spotted,
          peakScore: token.score || 0,
          notified: true,
          stabilizing: true  // Skip dip alerts until we have multiple data points
        };

        // Alert for new token entering the list (only first time ever seen)
        const trulyNew = !everSeenTokens.has(tokenKey);
        if (trulyNew) {
          everSeenTokens.add(tokenKey); // Mark as seen
          const tokenData = {
            symbol: token.symbol || token.name,
            contractAddress: token.tokenAddress || token.address,
            imageUrl: token.logoUrl || token.imageUrl || token.image
          };
          // Use token's source field to determine which list it entered
          const tokenSource = token.source || 'degen';
          const listName = tokenSource === 'holder' || tokenSource === 'ex-holder' ? 'Holder' : 'Degen';
          this.addTerminalMessage(
            `${tokenData.symbol || 'New token'} entered the ${listName} list!`,
            'info',
            tokenData
          );
          recordAlert(tokenKey, 'new_entry', token.score);
        }
        return;
      }

      const score = token.score || 0;
      const prevScore = prevData.score || 0;
      const volume = token.volume || 0;
      const prevVolume = prevData.volume || 0;
      const prevRank = prevData.rank || currentRank;
      const tokenName = token.symbol || token.name || 'Unknown';

      const tokenData = {
        symbol: token.symbol || token.name,
        contractAddress: token.tokenAddress || token.address,
        imageUrl: token.logoUrl || token.imageUrl || token.image
      };

      // Update peak score
      if (score > prevData.peakScore) {
        prevData.peakScore = score;
      }

      const scoreGain = score - prevScore;
      const scoreChangePercent = prevScore > 0 ? (scoreGain / prevScore) * 100 : 0;

      // Score increasing rapidly (gained 2+ points) - only for tokens with score >= 8
      // Uses longer cooldown (60s) to prevent spam on hovering scores
      if (scoreGain >= 2 && score >= RAPID_GAIN_MIN_SCORE) {
        if (shouldAlert(tokenKey, 'rapid_gain', scoreGain)) {
          this.addTerminalMessage(`${tokenName} +${scoreGain.toFixed(1)} pts rapidly!`, 'alert', tokenData);
          recordAlert(tokenKey, 'rapid_gain', scoreGain);
          tokensGainingPoints++;
        }
      }

      // Rising fast - gained 3+ rank positions
      const rankGain = prevRank - currentRank;
      if (rankGain >= 3) {
        if (shouldAlert(tokenKey, 'rising_fast', rankGain)) {
          this.addTerminalMessage(`${tokenName} rose ${rankGain} positions!`, 'success', tokenData);
          recordAlert(tokenKey, 'rising_fast', rankGain);
          tokensMovingFast++;
        }
      }

      // Dip alert - dropped 30%+ from peak
      // Skip for tokens that are still stabilizing (just added after restart)
      // Skip if score went negative (bearish signal, different from momentum loss)
      if (!prevData.stabilizing && prevData.peakScore && score >= 0 && prevData.peakScore > score && prevData.peakScore > 1) {
        const dropFromPeak = prevData.peakScore - score;
        const dropPercent = Math.min((dropFromPeak / prevData.peakScore) * 100, 100);

        // Check if token has recovered from floor (remove from floor tracking)
        const recoveryThreshold = prevData.peakScore * 0.5; // 50% of peak
        if (floorAlertedTokens.has(tokenKey) && score >= recoveryThreshold) {
          floorAlertedTokens.delete(tokenKey); // Allow future alerts
        }

        // Skip if already alerted for floor (100% drop)
        const atFloor = dropPercent >= 100;
        if (atFloor && floorAlertedTokens.has(tokenKey)) {
          // Already alerted for this floor, skip
        } else if (dropPercent >= 30 && dropPercent < 70 && dropFromPeak >= 1) {
          if (shouldAlert(tokenKey, 'dip', dropPercent)) {
            this.addTerminalMessage(`${tokenName} dipped ${dropPercent.toFixed(0)}% from peak`, 'warning', tokenData);
            recordAlert(tokenKey, 'dip', dropPercent);
            // Track floor alerts to prevent spam
            if (atFloor) {
              floorAlertedTokens.add(tokenKey);
            }
          }
        }
        // No alerts for drops of 70% or more
      }

      // 3x multiplier hit (one-time alert per token)
      const multiplier = parseFloat(token.multiplier?.replace('x', '') || 0);
      if (multiplier >= 3 && multiplier < 4 && !threeXAlertedTokens.has(tokenKey)) {
        threeXAlertedTokens.add(tokenKey);
        this.addTerminalMessage(`${tokenName} hit ${multiplier.toFixed(1)}x! TIER 3 ALERT!`, 'alert', tokenData);
      }

      // Milestone scores for 0-15 range: hitting 5, 10, 15 (one-time alert per milestone)
      if (score > prevScore) {
        if (score >= 5 && prevScore < 5 && score < 7 && !milestone5AlertedTokens.has(tokenKey)) {
          milestone5AlertedTokens.add(tokenKey);
          this.addTerminalMessage(`${tokenName} hit 5 pts!`, 'success', tokenData);
        } else if (score >= 10 && prevScore < 10 && score < 12 && !milestone10AlertedTokens.has(tokenKey)) {
          milestone10AlertedTokens.add(tokenKey);
          this.addTerminalMessage(`${tokenName} hit 10 pts!`, 'success', tokenData);
        } else if (score >= 15 && prevScore < 15 && score < 17 && !milestone15AlertedTokens.has(tokenKey)) {
          milestone15AlertedTokens.add(tokenKey);
          this.addTerminalMessage(`${tokenName} hit 15 pts! Running!`, 'success', tokenData);
        }
      }

      // Volume surge (50%+ increase with meaningful volume) - WITH SPAM PREVENTION
      if (volume > prevVolume * 1.5 && volume > 1000) {
        if (shouldAlert(tokenKey, 'volume_surge', volume)) {
          this.addTerminalMessage(`${tokenName} volume surging!`, 'warning', tokenData);
          recordAlert(tokenKey, 'volume_surge', volume);
        }
      }

      // Update previous data
      previousTokenData[tokenKey] = {
        score: token.score,
        volume: token.volume,
        spotted: token.spotted,
        rank: currentRank,
        peakScore: prevData.peakScore,
        notified: true,
        stabilizing: false  // No longer stabilizing after first real update
      };
    });

    // Network activity alert - multiple tokens moving fast
    if (tokensMovingFast >= 3 || tokensGainingPoints >= 4) {
      const networkKey = 'network_activity';
      if (shouldAlert(networkKey, 'network', tokensMovingFast + tokensGainingPoints)) {
        this.addTerminalMessage(
          `Network active: ${tokensMovingFast} rising, ${tokensGainingPoints} gaining`,
          'info',
          null
        );
        recordAlert(networkKey, 'network', tokensMovingFast + tokensGainingPoints);
      }
    }

    // Clean up tokens that left the list
    Object.keys(previousTokenData).forEach(key => {
      if (!currentAddresses.has(key)) {
        delete previousTokenData[key];
        tokenAlertHistory.delete(key);
      }
    });
  }

  setupVolumeControl() {
    const volumeBtn = document.getElementById('volume-btn');
    const sliderContainer = document.getElementById('volume-popup');
    const volumeSlider = document.getElementById('volume-slider');
    const volumeValue = document.getElementById('volume-value');

    if (!volumeBtn || !sliderContainer || !volumeSlider || !volumeValue) return;

    volumeSlider.value = this.alertVolume;
    volumeValue.textContent = `${this.alertVolume}%`;

    volumeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      sliderContainer.classList.toggle('visible');
    });

    volumeSlider.addEventListener('input', (e) => {
      const value = parseInt(e.target.value);
      this.alertVolume = value;
      this.tier1AlertSound.volume = value / 100;
      volumeValue.textContent = `${value}%`;
      localStorage.setItem('dexterAlertVolume', value.toString());
    });

    volumeSlider.addEventListener('change', () => {
      this.playTier1Alert();
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.volume-popup') && !e.target.closest('#volume-btn')) {
        sliderContainer.classList.remove('visible');
      }
    });
  }


  setupTelegramAutoAlert() {
    const checkbox = document.getElementById('telegram-auto-alert-checkbox');
    const publicCheckbox = document.getElementById('public-channels-checkbox');
    if (!checkbox) return;

    checkbox.checked = this.telegramAutoAlert;

    // Update public channels checkbox state
    this.updatePublicChannelsState();

    // CRITICAL FIX: Sync state to backend on page load
    this.syncTelegramMessagingToBackend();

    checkbox.addEventListener('change', async (e) => {
      this.telegramAutoAlert = e.target.checked;
      localStorage.setItem('telegramAutoAlert', this.telegramAutoAlert.toString());
      console.log('✅ Telegram messaging:', this.telegramAutoAlert ? 'enabled' : 'disabled');

      // Update public channels checkbox state
      this.updatePublicChannelsState();

      // Send to backend
      await this.syncTelegramMessagingToBackend();
    });
  }

  // NEW: Sync Telegram messaging state to backend
  async syncTelegramMessagingToBackend() {
    try {
      const response = await fetch(`${API_BASE}/telegram/toggle-messaging`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: this.telegramAutoAlert })
      });
      
      const result = await response.json();
      if (result.success) {
        console.log('✅ Backend synced: Telegram messaging', this.telegramAutoAlert ? 'enabled' : 'disabled');
      } else {
        console.warn('⚠️ Failed to sync Telegram messaging state to backend');
      }
    } catch (error) {
      console.warn('❌ Failed to update backend telegram messaging setting:', error);
    }
  }

  updatePublicChannelsState() {
    const publicCheckbox = document.getElementById('public-channels-checkbox');
    const headerToggle = document.getElementById('header-public-toggle');
    if (!publicCheckbox) return;

    // Disable public channels checkbox when telegram messaging is off
    if (!this.telegramAutoAlert) {
      publicCheckbox.disabled = true;
      publicCheckbox.checked = false;
      this.publicChannelsEnabled = false;
      localStorage.setItem('publicChannelsEnabled', 'false');

      // Update header toggle
      if (headerToggle) {
        headerToggle.classList.remove('active');
      }
    } else {
      publicCheckbox.disabled = false;
    }
  }

  setupPublicChannels() {
    const checkbox = document.getElementById('public-channels-checkbox');
    if (!checkbox) return;

    checkbox.checked = this.publicChannelsEnabled;

    // CRITICAL FIX: Sync state to backend on page load
    this.syncPublicChannelsToBackend();

    checkbox.addEventListener('change', async (e) => {
      this.publicChannelsEnabled = e.target.checked;
      localStorage.setItem('publicChannelsEnabled', this.publicChannelsEnabled.toString());
      console.log('✅ Public channel:', this.publicChannelsEnabled ? 'enabled' : 'disabled');

      // Send to backend
      await this.syncPublicChannelsToBackend();
    });
  }

  // NEW: Sync public channels state to backend
  async syncPublicChannelsToBackend() {
    try {
      const response = await fetch(`${API_BASE}/telegram/toggle-public`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: this.publicChannelsEnabled })
      });
      
      const result = await response.json();
      if (result.success) {
        console.log('✅ Backend synced: Public channel', this.publicChannelsEnabled ? 'enabled' : 'disabled');
      } else {
        console.warn('⚠️ Failed to sync public channel state to backend');
      }
    } catch (error) {
      console.warn('❌ Failed to update backend public channel setting:', error);
    }
  }

  setupEventListeners() {
    // Mode button listeners (DEGEN / HOLDER / RADAR) - Now using radio buttons
    document.querySelectorAll('input[name="mode"]').forEach(radio => {
      radio.addEventListener('change', async (e) => {
        const newMode = e.target.value;
        if (newMode === currentMode) return;

        currentMode = newMode;
        lastRenderedData = null;
        lastRenderedMVP = null;

        // Toggle view tabs based on mode
        const holderCurrentTab = document.getElementById('holder-current-tab');
        const contentGrid = document.getElementById('content-grid');
        const radarView = document.getElementById('radar-view');

        // Update body data-mode attribute for color switching
        document.body.setAttribute('data-mode', currentMode);

        // Handle radar mode display
        if (currentMode === 'radar') {
          if (contentGrid) contentGrid.style.display = 'none';
          if (radarView) {
            radarView.style.display = 'flex';
            // Add mode transition glow effect
            radarView.classList.add('mode-transition');
            setTimeout(() => radarView.classList.remove('mode-transition'), 800);
          }
          // Set view mode to all-time for radar
          currentViewMode = 'all-time';
          // Update time tab display
          document.querySelectorAll('.time-tab').forEach(t => t.style.display = '');
          if (holderCurrentTab) holderCurrentTab.style.display = 'none';
          document.querySelectorAll('.time-tab').forEach(t => t.classList.remove('active'));
          const allTimeTab = document.querySelector('.time-tab[data-view="all-time"]');
          if (allTimeTab) allTimeTab.classList.add('active');
          // Update display mode text
          const displayMode = document.getElementById('header-mode-text');
          if (displayMode) displayMode.textContent = 'RADAR MODE';
        } else {
          if (contentGrid) contentGrid.style.display = 'grid';
          if (radarView) radarView.style.display = 'none';

          // Update display mode text for degen/holder
          const displayMode = document.getElementById('header-mode-text');
          if (displayMode) {
            displayMode.textContent = currentMode === 'holder' ? 'HOLDER MODE' : 'DEGEN MODE';
          }

          // Update header mode options visual state
          document.querySelectorAll('.header-mode-option').forEach(o => o.classList.remove('active'));
          const activeModeOption = document.querySelector(`.header-mode-option[data-mode="${currentMode}"]`);
          if (activeModeOption) activeModeOption.classList.add('active');

          if (holderCurrentTab) {
            if (currentMode === 'holder') {
              // Hide time-based tabs in holder mode, show current tab
              document.querySelectorAll('.time-tab:not(#holder-current-tab)').forEach(t => t.style.display = 'none');
              holderCurrentTab.style.display = 'inline-block';
              document.querySelectorAll('.time-tab').forEach(t => t.classList.remove('active'));
              holderCurrentTab.classList.add('active');
              currentViewMode = 'current';
            } else {
              // Show all tabs in degen mode
              document.querySelectorAll('.time-tab').forEach(t => t.style.display = '');
              holderCurrentTab.style.display = 'none';
              document.querySelectorAll('.time-tab').forEach(t => t.classList.remove('active'));
              document.querySelector('.time-tab[data-view="all-time"]').classList.add('active');
              currentViewMode = 'all-time';
            }
          }
        }

        try {
          await fetch(`${API_BASE}/mode`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: currentMode === 'radar' ? 'degen' : currentMode })
          });
        } catch (error) {
          console.warn('Failed to update backend mode:', error);
        }

        this.fetchTokens();
      });
    });

    // View tab listeners
    document.querySelectorAll('.time-tab').forEach(tab => {
      tab.addEventListener('click', async (e) => {
        document.querySelectorAll('.time-tab').forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
        currentViewMode = e.target.getAttribute('data-view');
        lastRenderedData = null;
        lastRenderedMVP = null;

        try {
          await fetch(`${API_BASE}/view-mode`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ viewMode: currentViewMode })
          });
        } catch (error) {
          console.warn('Failed to update backend view mode:', error);
        }

        this.fetchTokens();
      });
    });

    // Sort header listeners with 3-state toggle
    document.querySelectorAll('.th[data-sort]').forEach(header => {
      header.addEventListener('click', () => {
        const sortBy = header.getAttribute('data-sort');

        if (currentSortBy === sortBy) {
          // Cycle through states: default -> desc -> asc -> default
          if (currentSortState === 'default') {
            currentSortState = 'desc';
          } else if (currentSortState === 'desc') {
            currentSortState = 'asc';
          } else {
            currentSortState = 'default';
            currentSortBy = null;
          }
        } else {
          currentSortBy = sortBy;
          currentSortState = 'desc';
        }

        this.updateSortIndicators();
        this.renderTokens();
      });
    });

    this.updateSortIndicators();

    // ============================================================
    // NEW HEADER CONTROLS (from header-01.html mockup)
    // ============================================================

    // Header mode option listeners
    document.querySelectorAll('.header-mode-option').forEach(option => {
      option.addEventListener('click', async (e) => {
        const newMode = e.target.getAttribute('data-mode');
        if (newMode === currentMode) return;

        // Update visual state
        document.querySelectorAll('.header-mode-option').forEach(o => o.classList.remove('active'));
        e.target.classList.add('active');

        // Trigger the existing radio button to reuse existing logic
        const correspondingRadio = document.querySelector(`input[name="mode"][value="${newMode}"]`);
        if (correspondingRadio) {
          correspondingRadio.checked = true;
          correspondingRadio.dispatchEvent(new Event('change'));
        }
      });
    });

    // Header timeframe button listeners
    document.querySelectorAll('.header-timeframe-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const view = e.target.getAttribute('data-view');

        // Update visual state
        document.querySelectorAll('.header-timeframe-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');

        // Update view mode directly
        currentViewMode = view;
        lastRenderedData = null;
        lastRenderedMVP = null;

        // Update backend view mode
        try {
          await fetch(`${API_BASE}/view-mode`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ viewMode: currentViewMode })
          });
        } catch (error) {
          console.warn('Failed to update backend view mode:', error);
        }

        // Sync with time-tab elements if they exist (for compatibility)
        const correspondingTab = document.querySelector(`.time-tab[data-view="${view}"]`);
        if (correspondingTab) {
          document.querySelectorAll('.time-tab').forEach(t => t.classList.remove('active'));
          correspondingTab.classList.add('active');
        }

        // Fetch tokens with new view mode
        this.fetchTokens();
      });
    });

    // Header telegram toggle listener
    const headerTelegramToggle = document.getElementById('header-telegram-toggle');
    if (headerTelegramToggle) {
      headerTelegramToggle.addEventListener('click', () => {
        const checkbox = document.getElementById('telegram-auto-alert-checkbox');
        if (checkbox) {
          checkbox.checked = !checkbox.checked;
          checkbox.dispatchEvent(new Event('change'));
        }
        headerTelegramToggle.classList.toggle('active');
      });
    }

    // Header public channels toggle listener
    const headerPublicToggle = document.getElementById('header-public-toggle');
    if (headerPublicToggle) {
      headerPublicToggle.addEventListener('click', () => {
        const checkbox = document.getElementById('public-channels-checkbox');
        if (checkbox && !checkbox.disabled) {
          checkbox.checked = !checkbox.checked;
          checkbox.dispatchEvent(new Event('change'));
          headerPublicToggle.classList.toggle('active');
        }
      });
    }

    // MC Test button
    const mcTestBtn = document.getElementById('mc-test-btn');
    if (mcTestBtn) {
      mcTestBtn.addEventListener('click', () => this.runMcTest());
    }

    // Purge button
    const purgeBtn = document.getElementById('purge-btn');
    if (purgeBtn) {
      purgeBtn.addEventListener('click', () => this.runPurge());
    }

    // Check Tokens button
    const checkTokensBtn = document.getElementById('check-tokens-btn');
    if (checkTokensBtn) {
      checkTokensBtn.addEventListener('click', () => this.openCheckTokensWindow());
    }

    // Ignore List button
    const ignoreListBtn = document.getElementById('ignore-list-btn');
    if (ignoreListBtn) {
      ignoreListBtn.addEventListener('click', () => this.openIgnoreListWindow());
    }

    // Data Stats button
    const dataStatsBtn = document.getElementById('data-stats-btn');
    if (dataStatsBtn) {
      dataStatsBtn.addEventListener('click', () => this.openDataStatsWindow());
    }

    // Reset Terminal button
    const resetTerminalBtn = document.getElementById('reset-terminal-btn');
    if (resetTerminalBtn) {
      resetTerminalBtn.addEventListener('click', () => this.resetTerminalPosition());
    }

    // Telegram Tokens button
    const telegramTokensBtn = document.getElementById('telegram-tokens-btn');
    if (telegramTokensBtn) {
      telegramTokensBtn.addEventListener('click', () => this.openTelegramTokensWindow());
    }

    // Log to Telegram button (admin only)
    const logTelegramBtn = document.getElementById('log-telegram-btn');
    if (logTelegramBtn) {
      logTelegramBtn.addEventListener('click', () => this.openTelegramLoginModal());
    }

    // Telegram Login Modal handlers
    this.setupTelegramLoginModal();

    // Arrivals ticker copy to clipboard
    document.addEventListener('click', async (e) => {
      // Check if clicked on ticker symbol
      if (e.target.classList.contains('arrivals-ticker-copy')) {
        const ca = e.target.getAttribute('data-ca');
        if (ca) {
          try {
            await navigator.clipboard.writeText(ca);
            e.target.style.color = 'var(--status-green)';
            setTimeout(() => {
              e.target.style.color = '';
            }, 500);
          } catch (err) {
            // Fallback to older method
            try {
              const textArea = document.createElement('textarea');
              textArea.value = ca;
              textArea.style.position = 'fixed';
              textArea.style.left = '-999999px';
              textArea.style.top = '-999999px';
              document.body.appendChild(textArea);
              textArea.focus();
              textArea.select();
              document.execCommand('copy');
              document.body.removeChild(textArea);
              e.target.style.color = 'var(--status-green)';
              setTimeout(() => {
                e.target.style.color = '';
              }, 500);
            } catch (fallbackErr) {
              console.error('Failed to copy CA:', fallbackErr);
              e.target.style.color = 'var(--status-red)';
              setTimeout(() => {
                e.target.style.color = '';
              }, 500);
            }
          }
        }
        return;
      }

      // Check if clicked anywhere on arrivals token row (but not on ticker which is handled above)
      const tokenRow = e.target.closest('.arrivals-token');
      if (tokenRow && !e.target.classList.contains('arrivals-ticker-copy')) {
        const ca = tokenRow.getAttribute('data-address');
        if (ca) {
          try {
            await navigator.clipboard.writeText(ca);
            tokenRow.style.backgroundColor = 'var(--status-green-dim)';
            setTimeout(() => {
              tokenRow.style.backgroundColor = '';
            }, 300);
          } catch (err) {
            // Fallback to older method
            try {
              const textArea = document.createElement('textarea');
              textArea.value = ca;
              textArea.style.position = 'fixed';
              textArea.style.left = '-999999px';
              textArea.style.top = '-999999px';
              document.body.appendChild(textArea);
              textArea.focus();
              textArea.select();
              document.execCommand('copy');
              document.body.removeChild(textArea);
              tokenRow.style.backgroundColor = 'var(--status-green-dim)';
              setTimeout(() => {
                tokenRow.style.backgroundColor = '';
              }, 300);
            } catch (fallbackErr) {
              console.error('Failed to copy CA:', fallbackErr);
              tokenRow.style.backgroundColor = 'var(--status-red-dim)';
              setTimeout(() => {
                tokenRow.style.backgroundColor = '';
              }, 300);
            }
          }
        }
      }
    });

    // Admin lock button - Password protection
    this.setupPasswordProtection();
  }

  setupPasswordProtection() {
    const adminLock = document.getElementById('admin-lock');
    const passwordModalOverlay = document.getElementById('password-modal-overlay');
    const passwordInput = document.getElementById('password-input');
    const passwordError = document.getElementById('password-error');
    const passwordCancelBtn = document.getElementById('password-cancel-btn');
    const passwordSubmitBtn = document.getElementById('password-submit-btn');
    const quickActions = document.querySelector('.quick-actions');
    const CORRECT_PASSWORD = '123321';

    // Show password modal on lock click
    if (adminLock) {
      adminLock.addEventListener('click', () => {
        if (passwordModalOverlay) {
          passwordModalOverlay.classList.add('visible');
          if (passwordInput) {
            passwordInput.value = '';
            passwordInput.focus();
          }
          if (passwordError) {
            passwordError.textContent = '';
          }
        }
      });
    }

    // Handle cancel
    const closePasswordModal = () => {
      if (passwordModalOverlay) {
        passwordModalOverlay.classList.remove('visible');
      }
      if (passwordInput) passwordInput.value = '';
      if (passwordError) passwordError.textContent = '';
    };

    if (passwordCancelBtn) {
      passwordCancelBtn.addEventListener('click', closePasswordModal);
    }

    // Close on overlay click
    if (passwordModalOverlay) {
      passwordModalOverlay.addEventListener('click', (e) => {
        if (e.target === passwordModalOverlay) {
          closePasswordModal();
        }
      });
    }

    // Handle submit
    if (passwordSubmitBtn) {
      passwordSubmitBtn.addEventListener('click', () => {
        const enteredPassword = passwordInput ? passwordInput.value : '';

        if (enteredPassword === CORRECT_PASSWORD) {
          // Correct password - show quick actions
          if (quickActions) {
            quickActions.classList.add('visible');
          }
          // Change lock icon to unlocked
          if (adminLock) {
            adminLock.querySelector('.admin-lock-icon').textContent = '🔓';
          }
          closePasswordModal();
        } else {
          // Wrong password
          if (passwordError) {
            passwordError.textContent = '⚠ Incorrect password';
          }
          if (passwordInput) {
            passwordInput.value = '';
            passwordInput.focus();
          }
        }
      });
    }

    // Handle Enter key in password input
    if (passwordInput) {
      passwordInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          if (passwordSubmitBtn) {
            passwordSubmitBtn.click();
          }
        } else if (e.key === 'Escape') {
          closePasswordModal();
        }
      });
    }
  }

  setupWindowControls() {
    // Window controls for frameless window
    const minimizeBtn = document.getElementById('minimize-btn');
    const maximizeBtn = document.getElementById('maximize-btn');
    const closeBtn = document.getElementById('close-btn');

    if (minimizeBtn && window.windowControls) {
      minimizeBtn.addEventListener('click', () => {
        window.windowControls.minimize();
      });
    }

    if (maximizeBtn && window.windowControls) {
      maximizeBtn.addEventListener('click', () => {
        window.windowControls.maximize();
      });
    }

    if (closeBtn && window.windowControls) {
      closeBtn.addEventListener('click', () => {
        window.windowControls.close();
      });
    }
  }

  async initializeDexScreener() {
    try {
      await fetch(`${API_BASE}/data-source`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'dexscreener' })
      });
    } catch (error) {
      console.error('Failed to set DexScreener:', error);
    }
  }

  async initializeBackendViewMode() {
    try {
      await fetch(`${API_BASE}/view-mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ viewMode: currentViewMode })
      });
    } catch (error) {
      console.warn('Failed to initialize backend view mode:', error);
    }
  }

  async fetchAnnouncedTokens() {
    try {
      const response = await fetch(`${API_BASE}/telegram/announced`);
      if (!response.ok) return;
      const data = await response.json();
      const tokens = data.tokens || [];
      announcedTokenAddresses = new Set(tokens.map(t => t.contractAddress));
    } catch (error) {
      console.warn('Failed to fetch announced tokens:', error);
    }
  }

  async startPolling() {
    // Initialize notification terminal
    this.addTerminalMessage('System initialized', 'info');
    this.addTerminalMessage('Monitoring token activity...', 'info');

    await this.fetchTokens();
    await this.fetchAnnouncedTokens();
    await this.fetchTokenCounts();
    setInterval(() => {
      this.fetchTokens();
    }, 1000);

    setInterval(() => {
      this.fetchAnnouncedTokens();
    }, 5000);

    setInterval(() => {
      this.fetchTokenCounts();
    }, 5000);

    setInterval(() => {
      this.updateTimeDisplay();
    }, 500);

    setInterval(() => {
      this.updateClock();
    }, 1000);
    this.updateClock(); // Initial update
    this.setupChannelModal();
  }

  updateClock() {
    const clockEl = document.getElementById('footer-clock');
    if (clockEl) {
      const now = new Date();
      const hours = now.getHours();
      const minutes = now.getMinutes().toString().padStart(2, '0');
      const ampm = hours >= 12 ? 'PM' : 'AM';
      const displayHours = hours % 12 || 12;
      clockEl.innerHTML = `${displayHours}:${minutes} <span class="clock-ampm">${ampm}</span>`;
    }
  }

  async fetchTokenCounts() {
    try {
      const response = await fetch(`${API_BASE}/tokens/counts`);
      if (!response.ok) return;
      const data = await response.json();

      const degenCountEl = document.getElementById('degen-count-status');
      const holderCountEl = document.getElementById('holder-count-status');

      if (degenCountEl) degenCountEl.textContent = data.degen || 0;
      if (holderCountEl) holderCountEl.textContent = data.holder || 0;
    } catch (error) {
      console.error('Failed to fetch token counts:', error);
    }
  }

  setupChannelModal() {
    const manageChannelsBtn = document.getElementById('manage-channels-btn');
    const channelModalOverlay = document.getElementById('channel-modal-overlay');
    const closeChannelModal = document.getElementById('close-channel-modal');
    const saveChannelsBtn = document.getElementById('save-channels-btn');
    const cancelChannelsBtn = document.getElementById('cancel-channels-btn');

    if (!manageChannelsBtn) return;

    manageChannelsBtn.addEventListener('click', async () => {
      if (channelModalOverlay) {
        channelModalOverlay.classList.add('visible');
        await this.loadChannels();
      }
    });

    if (closeChannelModal) {
      closeChannelModal.addEventListener('click', () => {
        if (channelModalOverlay) channelModalOverlay.classList.remove('visible');
      });
    }

    if (cancelChannelsBtn) {
      cancelChannelsBtn.addEventListener('click', () => {
        if (channelModalOverlay) channelModalOverlay.classList.remove('visible');
      });
    }

    // Close on overlay click
    if (channelModalOverlay) {
      channelModalOverlay.addEventListener('click', (e) => {
        if (e.target === channelModalOverlay) {
          channelModalOverlay.classList.remove('visible');
        }
      });
    }
  }

  async loadChannels() {
    const channelsList = document.getElementById('channels-list');
    if (!channelsList) return;

    try {
      const response = await fetch(`${API_BASE}/telegram/channels`);
      const data = await response.json();
      const channels = data.channels || [];

      channelsList.innerHTML = channels.map((ch, index) => `
        <div class="channel-item">
          <input type="checkbox" class="channel-checkbox" ${ch.enabled ? 'checked' : ''} data-index="${index}">
          <input type="text" class="channel-url-input" value="${ch.url}" data-index="${index}">
          <button class="remove-channel-btn" data-index="${index}">✕</button>
        </div>
      `).join('');
    } catch (error) {
      console.error('Failed to load channels:', error);
    }
  }

  async fetchTokens() {
    try {
      // Handle radar mode - fetch and render radar data
      if (currentMode === 'radar') {
        await this.renderRadarMode();
        return;
      }

      // Use different endpoint based on mode
      const endpoint = currentMode === 'holder'
        ? `${API_BASE}/tokens/holder?viewMode=${currentViewMode}`
        : `${API_BASE}/tokens/top?viewMode=${currentViewMode}`;

      const response = await fetch(endpoint);
      if (!response.ok) throw new Error('Failed to fetch tokens');

      const data = await response.json();

      // Handle different response formats
      const tokenArray = currentMode === 'holder' ? data.tokens : data.top10;

      // Create a more efficient comparison that only checks relevant fields
      const hasRelevantChanges = (newTokens, oldData) => {
        if (!oldData || newTokens.length !== oldData.length) return true;

        const newAddresses = new Set(newTokens.map(t => t.contractAddress));
        const oldAddresses = new Set(oldData.map(t => t.contractAddress));

        // Check if any tokens were added or removed
        if (newAddresses.size !== oldAddresses.size) return true;
        for (const addr of newAddresses) {
          if (!oldAddresses.has(addr)) return true;
        }

        // Check if any values changed significantly
        for (const newToken of newTokens) {
          const oldToken = oldData.find(t => t.contractAddress === newToken.contractAddress);
          if (!oldToken) return true;

          // Check if important values changed
          if (Math.abs((newToken.currentMc || 0) - (oldToken.currentMc || 0)) > 100) return true;
          if (Math.abs((newToken.volume24h || 0) - (oldToken.volume24h || 0)) > 1000) return true;
          if (Math.abs((parseFloat(newToken.multiplier) || 0) - (parseFloat(oldToken.multiplier) || 0)) > 0.01) return true;
        }

        return false;
      };

      if (hasRelevantChanges(tokenArray || [], currentTopTokens)) {
        const newTokens = tokenArray || [];

        // Track addresses for cross-mode indicators
        if (currentMode === 'degen') {
          degenTokenAddresses.clear();
          newTokens.forEach(token => degenTokenAddresses.add(token.contractAddress));
        } else {
          holderTokenAddresses.clear();
          newTokens.forEach(token => holderTokenAddresses.add(token.contractAddress));
        }

        // Tier 1 alerts (degen mode only)
        if (currentMode === 'degen') {
          const tokensHittingTier1 = [];
          for (const token of newTokens) {
            const multiplier = parseFloat(token.multiplier?.replace('x', '') || 0);
            if (multiplier >= this.tierValues.tier1 && !this.alertedTokens.has(token.contractAddress)) {
              this.alertedTokens.add(token.contractAddress);
              tokensHittingTier1.push(token);
              console.log(`Tier 1 alert: ${token.name} hit ${token.multiplier}`);
            }
          }

          // Save persisted alerted tokens
          if (tokensHittingTier1.length > 0) {
            this.saveAlertedTokens();
          }

          // Batch alert - play once with count
          if (!this.isFirstFetch && tokensHittingTier1.length > 0) {
            this.playTier1Alert(tokensHittingTier1.length);
          }
        }

        if (this.isFirstFetch) {
          this.isFirstFetch = false;
          console.log('Initial tokens loaded, alerts enabled for new tier crossings');
        }

        currentTopTokens = newTokens;
        currentTierInfo = data.tierInfo || currentTierInfo;

        // Check for token events and update notification terminal
        this.checkForTokenEvents(newTokens);

        this.renderTokens();

        // Update header arrivals
        this.updateHeaderArrivals();
      }

      // Update MVP
      const newMVPData = JSON.stringify(data.mvp || null);
      if (newMVPData !== lastRenderedMVP) {
        if (currentMode === 'holder') {
          currentHolderMVP = data.mvp || null;
          currentMVP = null;
        } else {
          currentMVP = data.mvp || null;
          currentHolderMVP = null;
        }
        this.renderMVP();
        lastRenderedMVP = newMVPData;
      }
    } catch (error) {
      console.error('Fetch error:', error);
      this.showError('Failed to load tokens');
    }
  }

  updateTimeDisplay() {
    // Update time values in-place without triggering full re-render
    const rows = this.tokenContainer.querySelectorAll('.token-row');
    rows.forEach(row => {
      const address = row.getAttribute('data-address');
      const token = currentTopTokens.find(t => t.contractAddress === address);
      if (token) {
        const timeAgo = this.getTimeAgo(token.spottedAt);
        const timeCell = row.querySelector('.token-cell.time');
        if (timeCell && timeCell.textContent !== timeAgo) {
          timeCell.textContent = timeAgo;
        }
      }
    });

    // Update "Time as MVP" in real-time (only for degen mode, holder mode doesn't have mvpSince)
    const currentMode = document.querySelector('.mode-toggle.active')?.getAttribute('data-mode');
    if (currentMode !== 'holder') {
      const mvp = currentMVP;
      if (mvp && mvp.mvpSince) {
        const metrics = this.mvpContainer?.querySelectorAll('.mvp-metric');
        if (metrics && metrics.length > 5) {
          const timeMvpMetric = metrics[5]; // 6th metric is "TIME MVP"
          const valEl = timeMvpMetric.querySelector('.mvp-metric-value');
          if (valEl) {
            const newTimeAsMVP = this.getTimeAsMVP(mvp.mvpSince);
            if (valEl.textContent !== newTimeAsMVP) {
              valEl.textContent = newTimeAsMVP;
            }
          }
        }
      }
    }
  }

  updateSortIndicators() {
    document.querySelectorAll('.th[data-sort]').forEach(header => {
      const arrow = header.querySelector('.sort-arrow');
      if (arrow) arrow.remove();
    });

    if (currentSortBy && currentSortState !== 'default') {
      const activeHeader = document.querySelector(`.th[data-sort="${currentSortBy}"]`);
      if (activeHeader) {
        const arrow = document.createElement('span');
        arrow.className = 'sort-arrow';
        arrow.textContent = currentSortState === 'asc' ? '▲' : '▼';
        activeHeader.appendChild(arrow);
      }
    }
  }

  sortTokens(tokens) {
    if (currentSortState === 'default' || !currentSortBy) {
      return tokens;
    }

    return tokens.sort((a, b) => {
      let valA, valB;

      switch(currentSortBy) {
        case 'spotted':
          valA = a.spottedMc;
          valB = b.spottedMc;
          break;
        case 'current':
          valA = a.currentMc;
          valB = b.currentMc;
          break;
        case 'volume':
          valA = a.volume24h;
          valB = b.volume24h;
          break;
        case 'net':
          valA = a.netPercent || 0;
          valB = b.netPercent || 0;
          break;
        case 'score':
          valA = a.score ?? -Infinity;
          valB = b.score ?? -Infinity;
          break;
        case 'time':
          valA = Date.now() - a.spottedAt;
          valB = Date.now() - b.spottedAt;
          break;
        case 'peak':
        default:
          valA = parseFloat(a.multiplier.replace('x', ''));
          valB = parseFloat(b.multiplier.replace('x', ''));
          break;
      }

      if (currentSortState === 'asc') {
        return valA - valB;
      } else {
        return valB - valA;
      }
    });
  }

  renderTokens() {
    if (currentTopTokens.length === 0) {
      this.tokenContainer.innerHTML = `<div class="empty-state"><div class="empty-icon"><span class="icon-spinner">◌</span></div><div class="empty-text">Scanning network...</div><div class="empty-subtext">awaiting token data stream</div></div>`;
      return;
    }

    const sortedTokens = this.sortTokens([...currentTopTokens]);
    const existingRows = this.tokenContainer.querySelectorAll('.token-row');

    // Check if tokens were added or removed (requires full render)
    const currentAddresses = new Set(Array.from(existingRows).map(r => r.getAttribute('data-address')));
    const newAddresses = new Set(sortedTokens.map(t => t.contractAddress));
    const hasAddedOrRemoved =
      currentAddresses.size !== newAddresses.size ||
      ![...currentAddresses].every(addr => newAddresses.has(addr));

    if (hasAddedOrRemoved || existingRows.length === 0) {
      this.fullRenderTokens(sortedTokens);
      return;
    }

    // Tokens are the same, just check if we need to reorder
    const needsReorder = Array.from(existingRows).some((row, index) => {
      return sortedTokens[index].contractAddress !== row.getAttribute('data-address');
    });

    if (needsReorder) {
      this.reorderAndUpdateTokens(sortedTokens);
    } else {
      // Same order, just update values in place
      this.updateTokensInPlace(sortedTokens);
    }
  }

  fullRenderTokens(sortedTokens) {
    const html = sortedTokens.map((token, index) => {
      token.rank = index + 1;
      const rankClass = `rank-${token.rank}`;
      const timeAgo = this.getTimeAgo(token.spottedAt);
      const multiplier = token.multiplier;

      const spottedMc = this.formatCurrency(token.spottedMc);
      const currentMc = this.formatCurrency(token.currentMc);
      const volume = this.formatCurrency(token.volume24h);

      const mcChange = token.mcTenSecondsAgo ? token.currentMc - token.mcTenSecondsAgo : 0;
      const volChange = token.volTenSecondsAgo ? token.volume24h - token.volTenSecondsAgo : 0;

      const mcChangePercent = token.mcTenSecondsAgo && token.mcTenSecondsAgo > 0 ? (mcChange / token.mcTenSecondsAgo) * 100 : 0;
      const volChangePercent = token.volTenSecondsAgo && token.volTenSecondsAgo > 0 ? (volChange / token.volTenSecondsAgo) * 100 : 0;

      const mcArrows = this.getArrows(mcChangePercent);
      const volArrows = this.getArrows(volChangePercent);

      const netPercent = token.netPercent || 0;
      const netClass = netPercent >= 0 ? 'positive' : 'negative';
      const netSign = netPercent >= 0 ? '+' : '';
      const netDisplay = `${netSign}${netPercent.toFixed(1)}%`;

      const iconHtml = token.logoUrl
        ? `<img src="${token.logoUrl}" alt="${token.name}" onerror="this.style.display='none';" />`
        : `<span>${token.symbol ? token.symbol.charAt(0).toUpperCase() : token.name.charAt(0).toUpperCase()}</span>`;

      // Determine chain display name and icon
      const chainShort = token.chainShort || token.chainId || 'sol';
      const chainIcon = this.getChainIcon(chainShort);
      const caDisplay = `${token.contractAddress} ${chainIcon}`;

      // Check if token was announced to telegram
      const isAnnounced = announcedTokenAddresses.has(token.contractAddress);
      const telegramIndicator = isAnnounced ? `
        <span class="token-telegram-indicator" title="Announced to Telegram">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.161c-.18 1.897-.962 6.502-1.359 8.627-.168.9-.5 1.201-.82 1.23-.697.064-1.226-.461-1.901-.903-1.056-.692-1.653-1.123-2.678-1.799-1.185-.781-.417-1.21.258-1.911.177-.184 3.247-2.977 3.307-3.23.007-.032.015-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.139-5.062 3.345-.479.329-.913.489-1.302.481-.428-.009-1.252-.242-1.865-.442-.752-.244-1.349-.374-1.297-.789.027-.216.324-.437.893-.663 3.498-1.524 5.831-2.529 6.998-3.015 3.333-1.386 4.025-1.627 4.477-1.635.099-.002.321.023.465.141.121.1.155.233.171.327.016.093.036.305.02.469z"/>
          </svg>
        </span>
      ` : '';

      previousTokenData[token.contractAddress] = {
        currentMc: token.currentMc,
        volume24h: token.volume24h,
        peakMultiplier: token.peakMultiplier
      };

      return `
        <div class="token-row ${rankClass}" data-address="${token.contractAddress}" data-is-mvp="${token.isMVP ? 'true' : 'false'}" title="Click to copy address">
          <div class="token-rank">${token.rank}</div>
          <div class="token-main">
            <div class="token-icon" data-copy-ca="true">${iconHtml}</div>
            <div class="token-info">
              <div class="token-name" data-copy-ca="true">${token.name}${telegramIndicator}</div>
              <div class="token-address token-address-subtle" data-copy-ca="true" title="${token.contractAddress} | ${chainShort.toUpperCase()}">${caDisplay}</div>
            </div>
          </div>
          <div class="token-cell spotted">${spottedMc}</div>
          <div class="token-cell current">${currentMc}${mcArrows}</div>
          <div class="token-cell volume">${volume}${volArrows}</div>
          <div class="token-cell net ${netClass}">${netDisplay}</div>
          <div class="token-cell score">${token.score != null ? token.score.toFixed(1) : 'N/A'}</div>
          <div class="token-cell time">${timeAgo}</div>
          <div class="token-cell peak">${multiplier}</div>
          <div class="token-actions">
            <button class="token-action-btn blacklist-btn" data-address="${token.contractAddress}" data-name="${token.name}" title="Blacklist token">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 6h18"></path>
                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                <line x1="10" y1="11" x2="10" y2="17"></line>
                <line x1="14" y1="11" x2="14" y2="17"></line>
              </svg>
            </button>
          </div>
          <div class="token-actions">
            <button class="token-action-btn telegram-btn" data-address="${token.contractAddress}" title="Send to Telegram">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.161c-.18 1.897-.962 6.502-1.359 8.627-.168.9-.5 1.201-.82 1.23-.697.064-1.226-.461-1.901-.903-1.056-.692-1.653-1.123-2.678-1.799-1.185-.781-.417-1.21.258-1.911.177-.184 3.247-2.977 3.307-3.23.007-.032.015-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.139-5.062 3.345-.479.329-.913.489-1.302.481-.428-.009-1.252-.242-1.865-.442-.752-.244-1.349-.374-1.297-.789.027-.216.324-.437.893-.663 3.498-1.524 5.831-2.529 6.998-3.015 3.333-1.386 4.025-1.627 4.477-1.635.099-.002.321.023.465.141.121.1.155.233.171.327.016.093.036.305.02.469z"/>
              </svg>
            </button>
          </div>
        </div>
      `;
    }).join('');

    this.tokenContainer.innerHTML = html;

    this.setupCardClickListeners();
    this.setupBlacklistListeners();
    this.setupTelegramListeners();
  }

  updateTokensInPlace(sortedTokens) {
    const rows = this.tokenContainer.querySelectorAll('.token-row');

    sortedTokens.forEach((token, index) => {
      const row = rows[index];
      if (!row || row.getAttribute('data-address') !== token.contractAddress) {
        // Row mismatch, trigger full render
        this.fullRenderTokens(sortedTokens);
        return;
      }

      token.rank = index + 1;
      const prevData = previousTokenData[token.contractAddress] || {};

      // Helper to update element if changed
      const updateIfChanged = (selector, newValue, isHtml = false) => {
        const el = row.querySelector(selector);
        if (el) {
          const currentValue = isHtml ? el.innerHTML : el.textContent;
          if (currentValue !== newValue) {
            if (isHtml) {
              el.innerHTML = newValue;
            } else {
              el.textContent = newValue;
            }
          }
        }
      };

      // Update rank
      updateIfChanged('.token-rank', token.rank);
      row.className = `token-row rank-${token.rank}`;

      // Update telegram indicator
      const isAnnounced = announcedTokenAddresses.has(token.contractAddress);
      const tokenNameEl = row.querySelector('.token-name');
      if (tokenNameEl) {
        const existingIndicator = tokenNameEl.querySelector('.token-telegram-indicator');
        if (isAnnounced && !existingIndicator) {
          // Add indicator
          const indicator = document.createElement('span');
          indicator.className = 'token-telegram-indicator';
          indicator.title = 'Announced to Telegram';
          indicator.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.161c-.18 1.897-.962 6.502-1.359 8.627-.168.9-.5 1.201-.82 1.23-.697.064-1.226-.461-1.901-.903-1.056-.692-1.653-1.123-2.678-1.799-1.185-.781-.417-1.21.258-1.911.177-.184 3.247-2.977 3.307-3.23.007-.032.015-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.139-5.062 3.345-.479.329-.913.489-1.302.481-.428-.009-1.252-.242-1.865-.442-.752-.244-1.349-.374-1.297-.789.027-.216.324-.437.893-.663 3.498-1.524 5.831-2.529 6.998-3.015 3.333-1.386 4.025-1.627 4.477-1.635.099-.002.321.023.465.141.121.1.155.233.171.327.016.093.036.305.02.469z"/></svg>';
          tokenNameEl.appendChild(indicator);
        } else if (!isAnnounced && existingIndicator) {
          // Remove indicator
          existingIndicator.remove();
        }
      }

      // Calculate values
      const timeAgo = this.getTimeAgo(token.spottedAt);
      const spottedMc = this.formatCurrency(token.spottedMc);
      const currentMc = this.formatCurrency(token.currentMc);
      const volume = this.formatCurrency(token.volume24h);

      const mcChange = token.mcTenSecondsAgo ? token.currentMc - token.mcTenSecondsAgo : 0;
      const volChange = token.volTenSecondsAgo ? token.volume24h - token.volTenSecondsAgo : 0;

      const mcChangePercent = token.mcTenSecondsAgo && token.mcTenSecondsAgo > 0 ? (mcChange / token.mcTenSecondsAgo) * 100 : 0;
      const volChangePercent = token.volTenSecondsAgo && token.volTenSecondsAgo > 0 ? (volChange / token.volTenSecondsAgo) * 100 : 0;

      const mcArrows = this.getArrows(mcChangePercent);
      const volArrows = this.getArrows(volChangePercent);

      const netPercent = token.netPercent || 0;
      const netClass = netPercent >= 0 ? 'positive' : 'negative';
      const netSign = netPercent >= 0 ? '+' : '';
      const netDisplay = `${netSign}${netPercent.toFixed(1)}%`;

      // Update cells
      updateIfChanged('.token-cell.spotted', spottedMc);
      updateIfChanged('.token-cell.current', `${currentMc}${mcArrows}`, true);
      updateIfChanged('.token-cell.volume', `${volume}${volArrows}`, true);

      // Update net class and value
      const netCell = row.querySelector('.token-cell.net');
      if (netCell) {
        const currentClass = netCell.classList.contains('positive') ? 'positive' : 'negative';
        if (currentClass !== netClass || netCell.textContent !== netDisplay) {
          netCell.className = `token-cell net ${netClass}`;
          netCell.textContent = netDisplay;
        }
      }

      // Update score
      const scoreDisplay = token.score != null ? token.score.toFixed(1) : 'N/A';
      updateIfChanged('.token-cell.score', scoreDisplay);

      // Only update time if it changed significantly (to avoid constant updates)
      if (!prevData.lastTimeUpdate || Date.now() - prevData.lastTimeUpdate > 1000) {
        updateIfChanged('.token-cell.time', timeAgo);
        prevData.lastTimeUpdate = Date.now();
      }

      updateIfChanged('.token-cell.peak', token.multiplier);

      // Store previous data
      previousTokenData[token.contractAddress] = {
        currentMc: token.currentMc,
        volume24h: token.volume24h,
        peakMultiplier: token.peakMultiplier,
        lastTimeUpdate: prevData.lastTimeUpdate || Date.now()
      };
    });
  }

  reorderAndUpdateTokens(sortedTokens) {
    // Create a map of existing rows by address for O(1) lookup
    const rowsMap = new Map();
    this.tokenContainer.querySelectorAll('.token-row').forEach(row => {
      rowsMap.set(row.getAttribute('data-address'), row);
    });

    // Use DocumentFragment for efficient DOM manipulation
    const fragment = document.createDocumentFragment();

    sortedTokens.forEach((token, index) => {
      const row = rowsMap.get(token.contractAddress);
      if (row) {
        // Update rank and class
        token.rank = index + 1;
        row.className = `token-row rank-${token.rank}`;

        // Update content in place before moving
        this.updateSingleRowContent(row, token);

        // Move row to fragment (removes from current position)
        fragment.appendChild(row);
      }
    });

    // Replace children atomically (avoids flash from intermediate empty state)
    this.tokenContainer.replaceChildren(fragment);
  }

  updateSingleRowContent(row, token) {
    const prevData = previousTokenData[token.contractAddress] || {};

    // Update rank
    const rankEl = row.querySelector('.token-rank');
    if (rankEl && rankEl.textContent !== String(token.rank)) {
      rankEl.textContent = token.rank;
    }

    // Update telegram indicator
    const isAnnounced = announcedTokenAddresses.has(token.contractAddress);
    const tokenNameEl = row.querySelector('.token-name');
    if (tokenNameEl) {
      const existingIndicator = tokenNameEl.querySelector('.token-telegram-indicator');
      if (isAnnounced && !existingIndicator) {
        // Add indicator
        const indicator = document.createElement('span');
        indicator.className = 'token-telegram-indicator';
        indicator.title = 'Announced to Telegram';
        indicator.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.161c-.18 1.897-.962 6.502-1.359 8.627-.168.9-.5 1.201-.82 1.23-.697.064-1.226-.461-1.901-.903-1.056-.692-1.653-1.123-2.678-1.799-1.185-.781-.417-1.21.258-1.911.177-.184 3.247-2.977 3.307-3.23.007-.032.015-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.139-5.062 3.345-.479.329-.913.489-1.302.481-.428-.009-1.252-.242-1.865-.442-.752-.244-1.349-.374-1.297-.789.027-.216.324-.437.893-.663 3.498-1.524 5.831-2.529 6.998-3.015 3.333-1.386 4.025-1.627 4.477-1.635.099-.002.321.023.465.141.121.1.155.233.171.327.016.093.036.305.02.469z"/></svg>';
        tokenNameEl.appendChild(indicator);
      } else if (!isAnnounced && existingIndicator) {
        // Remove indicator
        existingIndicator.remove();
      }
    }

    // Calculate values
    const timeAgo = this.getTimeAgo(token.spottedAt);
    const spottedMc = this.formatCurrency(token.spottedMc);
    const currentMc = this.formatCurrency(token.currentMc);
    const volume = this.formatCurrency(token.volume24h);

    const mcChange = token.mcTenSecondsAgo ? token.currentMc - token.mcTenSecondsAgo : 0;
    const volChange = token.volTenSecondsAgo ? token.volume24h - token.volTenSecondsAgo : 0;

    const mcChangePercent = token.mcTenSecondsAgo && token.mcTenSecondsAgo > 0 ? (mcChange / token.mcTenSecondsAgo) * 100 : 0;
    const volChangePercent = token.volTenSecondsAgo && token.volTenSecondsAgo > 0 ? (volChange / token.volTenSecondsAgo) * 100 : 0;

    const mcArrows = this.getArrows(mcChangePercent);
    const volArrows = this.getArrows(volChangePercent);

    const netPercent = token.netPercent || 0;
    const netClass = netPercent >= 0 ? 'positive' : 'negative';
    const netSign = netPercent >= 0 ? '+' : '';
    const netDisplay = `${netSign}${netPercent.toFixed(1)}%`;

    // Update cells
    const updateIfChanged = (selector, newValue, isHtml = false) => {
      const el = row.querySelector(selector);
      if (el) {
        const currentValue = isHtml ? el.innerHTML : el.textContent;
        if (currentValue !== newValue) {
          if (isHtml) {
            el.innerHTML = newValue;
          } else {
            el.textContent = newValue;
          }
        }
      }
    };

    updateIfChanged('.token-cell.spotted', spottedMc);
    updateIfChanged('.token-cell.current', `${currentMc}${mcArrows}`, true);
    updateIfChanged('.token-cell.volume', `${volume}${volArrows}`, true);

    // Update net class and value
    const netCell = row.querySelector('.token-cell.net');
    if (netCell) {
      const currentClass = netCell.classList.contains('positive') ? 'positive' : 'negative';
      if (currentClass !== netClass || netCell.textContent !== netDisplay) {
        netCell.className = `token-cell net ${netClass}`;
        netCell.textContent = netDisplay;
      }
    }

    // Only update time if it changed significantly
    if (!prevData.lastTimeUpdate || Date.now() - prevData.lastTimeUpdate > 1000) {
      updateIfChanged('.token-cell.time', timeAgo);
      prevData.lastTimeUpdate = Date.now();
    }

    updateIfChanged('.token-cell.peak', token.multiplier);

    // Store previous data
    previousTokenData[token.contractAddress] = {
      currentMc: token.currentMc,
      volume24h: token.volume24h,
      peakMultiplier: token.peakMultiplier,
      lastTimeUpdate: prevData.lastTimeUpdate || Date.now()
    };
  }

  async renderMVP() {
    if (!this.mvpContainer) return;

    // Update badge based on mode
    const mvpBadge = document.querySelector('.mvp-badge');
    const mvpTitle = document.querySelector('.mvp-title');
    if (mvpBadge && mvpTitle) {
      if (currentMode === 'holder') {
        mvpBadge.textContent = 'TOP';
        mvpBadge.style.background = 'linear-gradient(135deg, #4ade80, #22c55e)';
        mvpTitle.textContent = 'Best Performer';
      } else {
        mvpBadge.textContent = 'MVP';
        mvpBadge.style.background = 'linear-gradient(135deg, #ff8c00, #ffa500)';
        mvpTitle.textContent = 'Momentum Leader';
      }
    }

    const mvp = currentMode === 'holder' ? currentHolderMVP : currentMVP;

    if (!mvp) {
      if (!this.mvpContainer.querySelector('.mvp-empty')) {
        const emptyHint = currentMode === 'holder'
          ? 'Waiting for holder coins...'
          : 'Waiting for eligible tokens...';
        this.mvpContainer.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">📊</div>
            <div class="empty-text">No ${currentMode === 'holder' ? 'Top Coin' : 'MVP'}</div>
            <div class="empty-subtext">${emptyHint}</div>
          </div>
        `;
      }
      return;
    }

    const existingToken = this.mvpContainer.querySelector('.mvp-token');
    const existingAddress = this.mvpContainer.getAttribute('data-mvp-address');

    if (existingToken && existingAddress === (mvp.contractAddress || mvp.address)) {
      if (currentMode === 'holder') {
        this.updateHolderMVPValues(mvp);
      } else {
        this.updateMVPValues(mvp);
      }
      return;
    }

    this.mvpContainer.setAttribute('data-mvp-address', mvp.contractAddress || mvp.address);
    if (currentMode === 'holder') {
      this.fullRenderHolderMVP(mvp);
    } else {
      await this.fullRenderMVP(mvp);
    }
  }

  updateMVPValues(mvp) {
    const updateEl = (el, newValue) => {
      if (el && el.textContent !== newValue) {
        el.textContent = newValue;
      }
    };

    // Update score
    const scoreEl = this.mvpContainer.querySelector('.mvp-score');
    if (scoreEl) {
      const newScore = mvp.score.toFixed(1);
      if (scoreEl.textContent !== newScore) {
        scoreEl.textContent = newScore;
      }
    }

    // Update inline stats below score (new hero stats grid)
    const heroStatValues = this.mvpContainer.querySelectorAll('.mvp-hero-stat-value');
    if (heroStatValues[0]) updateEl(heroStatValues[0], this.formatCurrency(mvp.currentMc));
    if (heroStatValues[1]) updateEl(heroStatValues[1], this.formatCurrency(mvp.volume24h));
    if (heroStatValues[2]) updateEl(heroStatValues[2], this.formatCurrency(mvp.spottedMc || 0));
    if (heroStatValues[3]) updateEl(heroStatValues[3], mvp.peakMultiplier ? mvp.peakMultiplier.toFixed(2) + 'x' : 'N/A');

    // Get components
    const components = mvp.components || {};
    const buyPressure = components.buyPressure || { raw: 0, weighted: 0 };
    const netBuyVolume = components.netBuyVolume || { raw: 0, weighted: 0 };
    const txnsVelocity = components.txnsVelocity || { raw: 0, weighted: 0 };
    const priceMomentum = components.priceMomentum || { raw: 0, weighted: 0 };
    const sseMomentum = components.sseMomentum || { raw: 0, weighted: 0 };

    // Update compact breakdown metrics
    const metrics = this.mvpContainer.querySelectorAll('.mvp-metric');

    // Buy Pressure (metric 0)
    if (metrics[0]) {
      const valEl = metrics[0].querySelector('.mvp-metric-value');
      const ptsEl = metrics[0].querySelector('.mvp-metric-pts');
      const buyPressureColor = this.getBuyPressureColor(buyPressure.raw);
      const newBuyPressure = `${(buyPressure.raw * 100).toFixed(1)}%`;

      if (valEl && valEl.textContent !== newBuyPressure) {
        valEl.textContent = newBuyPressure;
        valEl.style.color = buyPressureColor;
      }
      updateEl(ptsEl, buyPressure.weighted.toFixed(1));
    }

    // Net Buy Volume (metric 1)
    if (metrics[1]) {
      const valEl = metrics[1].querySelector('.mvp-metric-value');
      const ptsEl = metrics[1].querySelector('.mvp-metric-pts');
      const netVolColor = netBuyVolume.raw >= 0 ? '#4ade80' : '#f87171';
      const newNetVol = this.formatUSD(netBuyVolume.raw);

      if (valEl && valEl.textContent !== newNetVol) {
        valEl.textContent = newNetVol;
        valEl.style.color = netVolColor;
      }
      updateEl(ptsEl, netBuyVolume.weighted.toFixed(1));
    }

    // Transaction Velocity (metric 2)
    if (metrics[2]) {
      const valEl = metrics[2].querySelector('.mvp-metric-value');
      const ptsEl = metrics[2].querySelector('.mvp-metric-pts');
      const newTxns = `${txnsVelocity.raw} txns`;

      updateEl(valEl, newTxns);
      updateEl(ptsEl, txnsVelocity.weighted.toFixed(1));
    }

    // Price Momentum (metric 3)
    if (metrics[3]) {
      const valEl = metrics[3].querySelector('.mvp-metric-value');
      const ptsEl = metrics[3].querySelector('.mvp-metric-pts');
      const raw = priceMomentum.raw;
      const priceColor = raw >= 0 ? '#4ade80' : '#f87171';
      const newPriceMom = `${raw >= 0 ? '+' : ''}${raw.toFixed(1)}%`;

      if (valEl && valEl.textContent !== newPriceMom) {
        valEl.textContent = newPriceMom;
        valEl.style.color = priceColor;
      }
      updateEl(ptsEl, priceMomentum.weighted.toFixed(1));
    }

    // SSE Momentum (metric 4)
    if (metrics[4]) {
      const valEl = metrics[4].querySelector('.mvp-metric-value');
      const ptsEl = metrics[4].querySelector('.mvp-metric-pts');
      const raw = sseMomentum.raw;
      const sseColor = raw >= 0 ? '#4ade80' : '#f87171';
      const newSSE = `${raw >= 0 ? '+' : ''}${(raw * 100).toFixed(1)}%`;

      if (valEl && valEl.textContent !== newSSE) {
        valEl.textContent = newSSE;
        valEl.style.color = sseColor;
      }
      updateEl(ptsEl, sseMomentum.weighted.toFixed(1));
    }

    // Time as MVP (metric 5)
    if (metrics[5]) {
      const valEl = metrics[5].querySelector('.mvp-metric-value');
      const timeAsMVP = this.getTimeAsMVP(mvp.mvpSince);
      updateEl(valEl, timeAsMVP);
    }

    // Update metrics freshness indicator
    const freshEl = this.mvpContainer.querySelector('.mvp-breakdown-freshness');
    if (freshEl && mvp.metricsFresh !== undefined) {
      freshEl.textContent = mvp.metricsFresh ? 'FRESH' : 'STALE';
    }
  }

  updateHolderMVPValues(mvp) {
    const updateEl = (el, newValue) => {
      if (el && el.textContent !== newValue) {
        el.textContent = newValue;
      }
    };

    const statValues = this.mvpContainer.querySelectorAll('.mvp-stat-value');
    updateEl(statValues[0], this.formatCurrency(mvp.currentMc));
    updateEl(statValues[1], this.formatCurrency(mvp.spottedMc));

    // Peak
    const peakMult = mvp.peakMultiplier || 1.0;
    updateEl(statValues[2], peakMult.toFixed(2) + 'x');

    // Volume
    updateEl(statValues[3], this.formatCurrency(mvp.volume24h));
  }

  async fullRenderMVP(mvp) {
    const logoHtml = mvp.logoUrl
      ? `<img src="${mvp.logoUrl}" alt="${mvp.name}" onerror="this.style.display='none';" />`
      : `<span>${mvp.name.charAt(0).toUpperCase()}</span>`;

    const components = mvp.components || {};
    const buyPressure = components.buyPressure || { raw: 0, weighted: 0 };
    const netBuyVolume = components.netBuyVolume || { raw: 0, weighted: 0 };
    const txnsVelocity = components.txnsVelocity || { raw: 0, weighted: 0 };
    const priceMomentum = components.priceMomentum || { raw: 0, weighted: 0 };
    const sseMomentum = components.sseMomentum || { raw: 0, weighted: 0 };

    const buyPressureColor = this.getBuyPressureColor(buyPressure.raw);
    const buyPressurePercent = (buyPressure.raw * 100).toFixed(1);
    const netBuyVolumeColor = netBuyVolume.raw >= 0 ? '#4ade80' : '#f87171';
    const priceMomentumColor = priceMomentum.raw >= 0 ? '#4ade80' : '#f87171';
    const sseMomentumColor = sseMomentum.raw >= 0 ? '#4ade80' : '#f87171';
    const metricsFresh = mvp.metricsFresh !== undefined ? mvp.metricsFresh : true;

    // Extract ticker from name for display
    const tickerMatch = mvp.name.match(/\(([A-Z0-9]+)\)/);
    const ticker = tickerMatch ? tickerMatch[1] : mvp.name.substring(0, 6).toUpperCase();
    const displayName = tickerMatch ? mvp.name.replace(/\s*\([A-Z0-9]+\)\s*$/, '') : mvp.name;

    // Determine chain display name and icon
    const chainShort = mvp.chainShort || mvp.chainId || 'sol';
    const chainIcon = this.getChainIcon(chainShort);
    const shortCa = this.shortenAddress(mvp.contractAddress, 6, 4);
    const caDisplay = `${shortCa} ${chainIcon}`;

    // Get token image URL for living badge background
    const tokenImageUrl = mvp.logoUrl || '';

    // Extract dominant color from token image for dynamic theming
    const tokenColors = await this.extractTokenColor(tokenImageUrl);

    this.mvpContainer.innerHTML = `
      <div class="mvp-token">
        <div class="mvp-section mvp-hero" style="--token-glow: ${tokenColors.glow}; --token-overlay: ${tokenColors.overlay}; --token-border: ${tokenColors.border}; --token-primary: ${tokenColors.primary};">
          <!-- Living badge animated token background - dual layer cycling -->
          <div class="mvp-hero-badge mvp-badge-layer-1" ${tokenImageUrl ? `style="background-image: url('${tokenImageUrl}')"` : ''}></div>
          <div class="mvp-hero-badge mvp-badge-layer-2" ${tokenImageUrl ? `style="background-image: url('${tokenImageUrl}')"` : ''}></div>
          <div class="mvp-hero-badge-overlay"></div>

          <!-- Hero content -->
          <div class="mvp-hero-content">
            <!-- Big circular icon with score -->
            <div class="mvp-hero-score-row">
              <div class="mvp-hero-icon-circle">
                ${logoHtml}
              </div>
              <div class="mvp-hero-score">
                <span class="mvp-score">${mvp.score.toFixed(1)}</span>
                <span class="mvp-hero-label">MOMENTUM</span>
              </div>
            </div>
            <div class="mvp-hero-header">
              <span class="mvp-hero-ticker">${ticker}</span>
            </div>
            <div class="mvp-hero-ca" title="${mvp.contractAddress} | ${chainShort.toUpperCase()}">${caDisplay}</div>
          </div>

          <!-- Stats grid -->
          <div class="mvp-hero-stats">
            <div class="mvp-hero-stat">
              <span class="mvp-hero-stat-label">MC</span>
              <span class="mvp-hero-stat-value">${this.formatCurrency(mvp.currentMc)}</span>
            </div>
            <div class="mvp-hero-stat">
              <span class="mvp-hero-stat-label">VOL</span>
              <span class="mvp-hero-stat-value">${this.formatCurrency(mvp.volume24h)}</span>
            </div>
            <div class="mvp-hero-stat">
              <span class="mvp-hero-stat-label">SPOTTED</span>
              <span class="mvp-hero-stat-value">${this.formatCurrency(mvp.spottedMc)}</span>
            </div>
            <div class="mvp-hero-stat">
              <span class="mvp-hero-stat-label">PEAK</span>
              <span class="mvp-hero-stat-value">${mvp.peakMultiplier ? mvp.peakMultiplier.toFixed(2) + 'x' : 'N/A'}</span>
            </div>
          </div>
        </div>

        <!-- Compact Score Breakdown with custom SVG icons -->
        <div class="mvp-section mvp-breakdown-compact">
          <div class="mvp-breakdown-header">
            <span class="mvp-breakdown-title">SCORE BREAKDOWN</span>
            <span class="mvp-breakdown-freshness">${metricsFresh ? 'FRESH' : 'STALE'}</span>
          </div>
          <div class="mvp-breakdown-grid">
            <!-- Buy Pressure -->
            <div class="mvp-metric">
              <div class="mvp-metric-icon-wrapper">
                <svg class="mvp-metric-icon" viewBox="0 0 24 24">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" stroke="currentColor" stroke-width="1.3" fill="none"/>
                  <path d="M8 12l2 2 4-4" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </div>
              <span class="mvp-metric-name">BUY</span>
              <div class="mvp-metric-row">
                <span class="mvp-metric-value" style="color: ${buyPressureColor}">${buyPressurePercent}%</span>
                <span class="mvp-metric-pts">${buyPressure.weighted.toFixed(1)}</span>
              </div>
            </div>

            <!-- Net Buy Volume -->
            <div class="mvp-metric">
              <div class="mvp-metric-icon-wrapper">
                <svg class="mvp-metric-icon" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.3" fill="none"/>
                  <path d="M12 7v5l3 3" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M12 3v2m0 14v2M5 12H3m18 0h-2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                </svg>
              </div>
              <span class="mvp-metric-name">VOLUME</span>
              <div class="mvp-metric-row">
                <span class="mvp-metric-value" style="color: ${netBuyVolumeColor}">${this.formatUSD(netBuyVolume.raw)}</span>
                <span class="mvp-metric-pts">${netBuyVolume.weighted.toFixed(1)}</span>
              </div>
            </div>

            <!-- Transaction Velocity -->
            <div class="mvp-metric">
              <div class="mvp-metric-icon-wrapper">
                <svg class="mvp-metric-icon" viewBox="0 0 24 24">
                  <path d="M13 2L3 14h8l-1 8 10-12h-8l1-8z" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
                  <circle cx="13" cy="12" r="1.5" fill="currentColor"/>
                </svg>
              </div>
              <span class="mvp-metric-name">VELOCITY</span>
              <div class="mvp-metric-row">
                <span class="mvp-metric-value">${txnsVelocity.raw} <small>txns</small></span>
                <span class="mvp-metric-pts">${txnsVelocity.weighted.toFixed(1)}</span>
              </div>
            </div>

            <!-- Price Momentum -->
            <div class="mvp-metric">
              <div class="mvp-metric-icon-wrapper">
                <svg class="mvp-metric-icon" viewBox="0 0 24 24">
                  <path d="M3 3v18h18" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M18.7 8l-5.1 5.2-2.8-2.7L7 14.3" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </div>
              <span class="mvp-metric-name">PRICE</span>
              <div class="mvp-metric-row">
                <span class="mvp-metric-value" style="color: ${priceMomentumColor}">${priceMomentum.raw >= 0 ? '+' : ''}${priceMomentum.raw.toFixed(1)}%</span>
                <span class="mvp-metric-pts">${priceMomentum.weighted.toFixed(1)}</span>
              </div>
            </div>

            <!-- SSE Momentum -->
            <div class="mvp-metric">
              <div class="mvp-metric-icon-wrapper">
                <svg class="mvp-metric-icon" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="2" fill="currentColor"/>
                  <path d="M12 2v3m0 14v3M4.93 4.93l2.12 2.12m8.48 8.48l2.12 2.12M2 12h3m14 0h3M4.93 19.07l2.12-2.12m8.48-8.48l2.12-2.12" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/>
                  <circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="1.3" stroke-dasharray="3 2"/>
                </svg>
              </div>
              <span class="mvp-metric-name">SSE</span>
              <div class="mvp-metric-row">
                <span class="mvp-metric-value" style="color: ${sseMomentumColor}">${sseMomentum.raw >= 0 ? '+' : ''}${(sseMomentum.raw * 100).toFixed(1)}%</span>
                <span class="mvp-metric-pts">${sseMomentum.weighted.toFixed(1)}</span>
              </div>
            </div>

            <!-- Time as MVP (6th metric) - centered countdown, no score -->
            <div class="mvp-metric">
              <div class="mvp-metric-icon-wrapper">
                <svg class="mvp-metric-icon" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.3" fill="none"/>
                  <path d="M12 6v6l4 2" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
                  <circle cx="12" cy="12" r="1" fill="currentColor"/>
                </svg>
              </div>
              <span class="mvp-metric-name">TIME MVP</span>
              <div class="mvp-metric-row mvp-metric-row-centered">
                <span class="mvp-metric-value">${this.getTimeAsMVP(mvp.mvpSince)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    this.setupMVPClickListeners(mvp);
  }

  fullRenderHolderMVP(mvp) {
    const logoHtml = mvp.logoUrl
      ? `<img src="${mvp.logoUrl}" alt="${mvp.name}" onerror="this.style.display='none';" />`
      : `<span>${mvp.name.charAt(0).toUpperCase()}</span>`;

    // Determine chain display name and icon
    const chainShort = mvp.chainShort || mvp.chainId || 'sol';
    const chainIcon = this.getChainIcon(chainShort);
    const shortCa = this.shortenAddress(mvp.contractAddress, 6, 4);
    const caDisplay = `${shortCa} ${chainIcon}`;

    const currentGain = mvp.spottedMc > 0 ? ((mvp.currentMc - mvp.spottedMc) / mvp.spottedMc * 100) : 0;
    const gainClass = currentGain >= 0 ? 'positive' : 'negative';
    const gainSign = currentGain >= 0 ? '+' : '';

    this.mvpContainer.innerHTML = `
      <div class="mvp-token">
        <div class="mvp-header">
          <div class="mvp-logo">${logoHtml}</div>
          <div class="mvp-info">
            <div class="mvp-name">${mvp.name}</div>
            <div class="mvp-address" title="${mvp.contractAddress} | ${chainShort.toUpperCase()}">${caDisplay}</div>
          </div>
        </div>

        <div class="mvp-section">
          <div class="mvp-section-title">HOLDER SCORE</div>
          <div class="mvp-score">${mvp.score ? mvp.score.toFixed(1) : 'N/A'}</div>
        </div>

        <div class="mvp-section">
          <div class="mvp-section-title">GAIN</div>
          <div class="mvp-score ${gainClass}">${gainSign}${currentGain.toFixed(1)}%</div>
        </div>

        <div class="mvp-section">
          <div class="mvp-section-title">STATS</div>
          <div class="mvp-stats">
            <div class="mvp-stat">
              <div class="mvp-stat-label">Current MC</div>
              <div class="mvp-stat-value">${this.formatCurrency(mvp.currentMc)}</div>
            </div>
            <div class="mvp-stat">
              <div class="mvp-stat-label">Spotted MC</div>
              <div class="mvp-stat-value">${this.formatCurrency(mvp.spottedMc)}</div>
            </div>
            <div class="mvp-stat">
              <div class="mvp-stat-label">Peak</div>
              <div class="mvp-stat-value">${mvp.multiplier || 'N/A'}</div>
            </div>
            <div class="mvp-stat">
              <div class="mvp-stat-label">Volume 24h</div>
              <div class="mvp-stat-value">${this.formatCurrency(mvp.volume24h)}</div>
            </div>
          </div>
        </div>
      </div>
    `;

    this.setupMVPClickListeners(mvp);
  }

  setupMVPClickListeners(mvp) {
    const addressEl = this.mvpContainer.querySelector('.mvp-address');
    if (addressEl) {
      addressEl.style.cursor = 'pointer';
      addressEl.addEventListener('click', () => {
        this.copyToClipboard(mvp.contractAddress, addressEl);
      });
    }
  }

  setupCardClickListeners() {
    // Copy CA when clicking on CA, ticker, or image
    const copyElements = document.querySelectorAll('[data-copy-ca="true"]');
    copyElements.forEach(el => {
      el.style.cursor = 'pointer';
      el.addEventListener('click', (e) => {
        const row = e.target.closest('.token-row');
        if (row) {
          const address = row.getAttribute('data-address');
          this.copyToClipboard(address, row);
        }
      });
    });

    // Also copy when clicking anywhere on the row (except buttons)
    const cards = document.querySelectorAll('.token-row[data-address]');
    cards.forEach(card => {
      card.addEventListener('click', (e) => {
        // Ignore clicks on buttons or copy elements (handled separately)
        if (e.target.closest('.blacklist-btn')) return;
        if (e.target.closest('.telegram-btn')) return;
        if (e.target.closest('[data-copy-ca="true"]')) return;

        const address = card.getAttribute('data-address');
        this.copyToClipboard(address, card);
      });
    });
  }

  setupBlacklistListeners() {
    const buttons = document.querySelectorAll('.blacklist-btn');
    buttons.forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const address = btn.getAttribute('data-address');
        const name = btn.getAttribute('data-name');

        if (confirm(`Blacklist "${name}"?\n\nThis token will be permanently hidden and never tracked again.`)) {
          await this.blacklistToken(address, name);
        }
      });
    });
  }

  setupTelegramListeners() {
    const buttons = document.querySelectorAll('.telegram-btn');
    buttons.forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const address = btn.getAttribute('data-address');

        const originalHtml = btn.innerHTML;
        btn.innerHTML = '<span style="font-size:10px;">...</span>';
        btn.disabled = true;

        try {
          const response = await fetch(`${API_BASE}/telegram/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: address })
          });

          const result = await response.json();

          if (result.success) {
            // Refresh announced tokens to show the indicator
            this.fetchAnnouncedTokens();
            btn.innerHTML = '<span style="color:#4ade80;">✓</span>';
            setTimeout(() => {
              btn.innerHTML = originalHtml;
              btn.disabled = false;
            }, 1000);
          } else if (result.error && result.error.includes('not connected')) {
            btn.innerHTML = originalHtml;
            btn.disabled = false;
            this.openTelegramAuthWindow();
          } else {
            btn.innerHTML = '<span style="color:#f87171;">✗</span>';
            console.error('Telegram send failed:', result.error);
            setTimeout(() => {
              btn.innerHTML = originalHtml;
              btn.disabled = false;
            }, 1500);
          }
        } catch (error) {
          console.error('Telegram send error:', error);
          btn.innerHTML = '<span style="color:#f87171;">✗</span>';
          setTimeout(() => {
            btn.innerHTML = originalHtml;
            btn.disabled = false;
          }, 1500);
        }
      });
    });
  }

  openTelegramAuthWindow() {
    const newWindow = window.open('', 'Telegram Auth', 'width=400,height=350');

    if (!newWindow) {
      alert('Please allow popups to authenticate with Telegram');
      return;
    }

    newWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Telegram Authentication</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: 'Courier New', monospace;
            background: #1a1a1a;
            color: #e0e0e0;
            padding: 20px;
          }
          h1 {
            font-size: 16px;
            color: #29a9eb;
            margin-bottom: 20px;
            text-align: center;
          }
          .step {
            background: #2a2a2a;
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 15px;
          }
          .step-title {
            font-size: 12px;
            color: #888;
            margin-bottom: 10px;
            text-transform: uppercase;
          }
          input {
            width: 100%;
            padding: 10px;
            font-family: 'Courier New', monospace;
            font-size: 14px;
            background: #1a1a1a;
            border: 1px solid #444;
            color: #fff;
            border-radius: 4px;
            text-align: center;
            letter-spacing: 4px;
          }
          input:focus {
            outline: none;
            border-color: #29a9eb;
          }
          button {
            width: 100%;
            padding: 12px;
            font-family: 'Courier New', monospace;
            font-size: 14px;
            font-weight: 700;
            background: #29a9eb;
            color: #fff;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            transition: all 0.2s ease;
          }
          button:hover:not(:disabled) {
            background: #1e90d0;
          }
          button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }
          .status {
            text-align: center;
            font-size: 12px;
            margin-top: 15px;
            padding: 10px;
            border-radius: 4px;
          }
          .status.info { background: #2a2a2a; color: #888; }
          .status.success { background: #1a3a1a; color: #4ade80; }
          .status.error { background: #3a1a1a; color: #f87171; }
          .hidden { display: none; }
        </style>
      </head>
      <body>
        <h1>TELEGRAM AUTH</h1>

        <div id="step1" class="step">
          <div class="step-title">Step 1: Request Code</div>
          <button id="request-btn">Send Verification Code</button>
        </div>

        <div id="step2" class="step hidden">
          <div class="step-title">Step 2: Enter Code</div>
          <input type="text" id="code-input" placeholder="12345" maxlength="5" />
          <button id="verify-btn" style="margin-top:10px;">Verify Code</button>
        </div>

        <div id="step3" class="step hidden">
          <div class="step-title">2FA Password (if enabled)</div>
          <input type="password" id="password-input" placeholder="Password" />
          <button id="password-btn" style="margin-top:10px;">Submit</button>
        </div>

        <div id="status" class="status info">Click to send verification code to your phone</div>
      </body>
      </html>
    `);

    const API = 'http://localhost:3001/api';
    const step1 = newWindow.document.getElementById('step1');
    const step2 = newWindow.document.getElementById('step2');
    const step3 = newWindow.document.getElementById('step3');
    const statusEl = newWindow.document.getElementById('status');
    const requestBtn = newWindow.document.getElementById('request-btn');
    const verifyBtn = newWindow.document.getElementById('verify-btn');
    const passwordBtn = newWindow.document.getElementById('password-btn');
    const codeInput = newWindow.document.getElementById('code-input');
    const passwordInput = newWindow.document.getElementById('password-input');

    const setStatus = (msg, type) => {
      statusEl.textContent = msg;
      statusEl.className = 'status ' + type;
    };

    fetch(API + '/telegram/init', { method: 'POST' })
      .then(res => res.json())
      .then(data => {
        if (data.status === 'connected') {
          setStatus('Already connected! You can close this window.', 'success');
          step1.classList.add('hidden');
          setTimeout(() => newWindow.close(), 2000);
        }
      });

    requestBtn.addEventListener('click', async () => {
      requestBtn.disabled = true;
      setStatus('Sending code...', 'info');

      try {
        const res = await fetch(API + '/telegram/auth/start', { method: 'POST' });
        const data = await res.json();

        if (data.success) {
          step1.classList.add('hidden');
          step2.classList.remove('hidden');
          setStatus('Code sent to ' + data.phone, 'success');
          codeInput.focus();
        } else {
          setStatus('Error: ' + data.error, 'error');
          requestBtn.disabled = false;
        }
      } catch (err) {
        setStatus('Error: ' + err.message, 'error');
        requestBtn.disabled = false;
      }
    });

    verifyBtn.addEventListener('click', async () => {
      const code = codeInput.value.trim();
      if (!code) return;

      verifyBtn.disabled = true;
      setStatus('Verifying...', 'info');

      try {
        const res = await fetch(API + '/telegram/auth/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code })
        });
        const data = await res.json();

        if (data.success) {
          setStatus('Authenticated! You can close this window.', 'success');
          setTimeout(() => newWindow.close(), 2000);
        } else if (data.status === 'needs_password') {
          step2.classList.add('hidden');
          step3.classList.remove('hidden');
          setStatus('Enter your 2FA password', 'info');
          passwordInput.focus();
        } else {
          setStatus('Error: ' + data.error, 'error');
          verifyBtn.disabled = false;
        }
      } catch (err) {
        setStatus('Error: ' + err.message, 'error');
        verifyBtn.disabled = false;
      }
    });

    passwordBtn.addEventListener('click', async () => {
      const code = codeInput.value.trim();
      const password = passwordInput.value;
      if (!password) return;

      passwordBtn.disabled = true;
      setStatus('Verifying...', 'info');

      try {
        const res = await fetch(API + '/telegram/auth/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, password })
        });
        const data = await res.json();

        if (data.success) {
          setStatus('Authenticated! You can close this window.', 'success');
          setTimeout(() => newWindow.close(), 2000);
        } else {
          setStatus('Error: ' + data.error, 'error');
          passwordBtn.disabled = false;
        }
      } catch (err) {
        setStatus('Error: ' + err.message, 'error');
        passwordBtn.disabled = false;
      }
    });
  }

  async blacklistToken(address, name) {
    try {
      const response = await fetch(`${API_BASE}/blacklist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractAddress: address, name })
      });

      if (!response.ok) throw new Error('Failed to blacklist token');

      currentTopTokens = currentTopTokens.filter(t => t.contractAddress !== address);
      lastRenderedData = null;
      this.renderTokens();

      console.log(`Blacklisted: ${name} (${address})`);
    } catch (error) {
      console.error('Blacklist error:', error);
      alert('Failed to blacklist token. Please try again.');
    }
  }

  async copyToClipboard(text, element) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }

  getTimeAgo(timestamp) {
    const secondsAgo = Math.floor((Date.now() - timestamp) / 1000);

    if (secondsAgo < 60) return `${secondsAgo}s ago`;
    if (secondsAgo < 3600) return `${Math.floor(secondsAgo / 60)}m ago`;
    return `${Math.floor(secondsAgo / 3600)}h ago`;
  }

  getTimeAsMVP(timestamp) {
    if (!timestamp) return '—';
    const secondsAgo = Math.floor((Date.now() - timestamp) / 1000);

    if (secondsAgo < 60) return `${secondsAgo}s`;
    if (secondsAgo < 3600) return `${Math.floor(secondsAgo / 60)}m`;
    const hours = Math.floor(secondsAgo / 3600);
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
  }

  getArrows(percentChange) {
    const abs = Math.abs(percentChange);
    const isPositive = percentChange > 0;
    const color = isPositive ? '#4ade80' : '#f87171';

    let arrows = '';
    if (abs >= 25) arrows = '↑↑↑';
    else if (abs >= 15) arrows = '↑↑';
    else if (abs >= 5) arrows = '↑';
    else return '';

    if (!isPositive) {
      arrows = arrows.replace(/↑/g, '↓');
    }

    return `<span style="color: ${color};">${arrows}</span>`;
  }

  formatCurrency(value) {
    if (!value || value === 0) return '$0';
    if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
    if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
    if (value >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
    return `$${value.toFixed(2)}`;
  }

  // Helper: Get color for buy pressure (0-1)
  getBuyPressureColor(buyPressure) {
    // 0.5 = neutral (gray)
    // 1.0 = max bullish (green)
    // 0.0 = max bearish (red)
    if (buyPressure >= 0.5) {
      // Green gradient from 0.5 to 1.0
      const intensity = (buyPressure - 0.5) * 2; // 0 to 1
      return `rgba(74, 222, 128, ${0.3 + intensity * 0.7})`;
    } else {
      // Red gradient from 0.5 to 0.0
      const intensity = (0.5 - buyPressure) * 2; // 0 to 1
      return `rgba(248, 113, 113, ${0.3 + intensity * 0.7})`;
    }
  }

  // Helper: Format USD values
  formatUSD(value) {
    if (Math.abs(value) >= 1000) {
      return (value / 1000).toFixed(1) + 'k';
    }
    return value.toFixed(2);
  }

  // Helper: Format USD values (shorter version for badges)
  formatUSDShort(value) {
    if (Math.abs(value) >= 1000000) {
      return (value / 1000000).toFixed(1) + 'M';
    }
    if (Math.abs(value) >= 1000) {
      return (value / 1000).toFixed(1) + 'k';
    }
    return value.toFixed(0);
  }

  // Helper: Shorten contract address (e.g., "Abc123...xyz789")
  shortenAddress(address, startLength = 6, endLength = 4) {
    if (!address || address.length <= startLength + endLength) {
      return address || '';
    }
    return `${address.substring(0, startLength)}...${address.substring(address.length - endLength)}`;
  }

  // Helper: Get chain icon SVG
  getChainIcon(chainShort) {
    const isBnb = chainShort === 'bsc' || chainShort === 'bnb';
    const gradientId = 'solGrad_' + Math.random().toString(36).substr(2, 9);

    if (isBnb) {
      // Binance logo (official from Wikipedia - https://upload.wikimedia.org/wikipedia/commons/e/e8/Binance_Logo.svg)
      return `<svg class="chain-icon chain-icon-bnb" viewBox="0 0 126.611 126.611" xmlns="http://www.w3.org/2000/svg">
        <polygon fill="#F3BA2F" points="38.171,53.203 62.759,28.616 87.36,53.216 101.667,38.909 62.759,0 23.864,38.896"/>
        <rect x="3.644" y="53.188" transform="matrix(0.7071 0.7071 -0.7071 0.7071 48.7933 8.8106)" fill="#F3BA2F" width="20.233" height="20.234"/>
        <polygon fill="#F3BA2F" points="38.171,73.408 62.759,97.995 87.359,73.396 101.674,87.695 101.667,87.703 62.759,126.611 23.863,87.716 23.843,87.696"/>
        <rect x="101.64" y="53.189" transform="matrix(-0.7071 0.7071 -0.7071 -0.7071 235.5457 29.0503)" fill="#F3BA2F" width="20.234" height="20.233"/>
        <polygon fill="#F3BA2F" points="77.271,63.298 77.277,63.298 62.759,48.78 52.03,59.509 52.029,59.509 50.797,60.742 48.254,63.285 48.254,63.285 48.234,63.305 48.254,63.326 62.759,77.831 77.277,63.313 77.284,63.305"/>
      </svg>`;
    }

    // Solana icon (official gradient logo from solana.com)
    return `<svg class="chain-icon chain-icon-sol" viewBox="0 0 101 88" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="${gradientId}" x1="8.53" y1="90.1" x2="88.99" y2="-3.02" gradientUnits="userSpaceOnUse">
          <stop offset="0.08" stop-color="#9945FF"/>
          <stop offset="0.3" stop-color="#8752F3"/>
          <stop offset="0.5" stop-color="#5497D5"/>
          <stop offset="0.6" stop-color="#43B4CA"/>
          <stop offset="0.72" stop-color="#28E0B9"/>
          <stop offset="0.97" stop-color="#19FB9B"/>
        </linearGradient>
      </defs>
      <path fill="url(#${gradientId})" d="M100.48 69.38 83.81 86.8c-.36.38-.8.68-1.29.89-.49.2-1.01.31-1.54.31H1.94c-.38 0-.75-.11-1.06-.31-.32-.21-.56-.49-.71-.83-.16-.34-.2-.72-.14-1.08.06-.36.24-.7.49-.97L17.21 67.41c.36-.38.8-.68 1.29-.89.49-.2 1.01-.31 1.54-.31h79.03c.38 0 .75.11 1.06.31.32.21.56.49.71.83.16.34.2.72.14 1.08-.06.36-.24.7-.49.97zm-16.67-35.08c-.36-.38-.8-.68-1.29-.89-.49-.2-1.01-.31-1.54-.31H1.94c-.38 0-.75.11-1.06.31-.32.21-.56.49-.71.83-.16.34-.2.72-.14 1.08.06.36.24.7.49.97l16.69 17.42c.36.38.8.68 1.29.89.49.2 1.01.31 1.54.31h79.03c.38 0 .75-.11 1.06-.31.32-.21.56-.49.71-.83.16-.34.2-.72.14-1.08-.06-.36-.24-.7-.49-.97L83.81 34.3zM1.94 21.79h79.03c.53 0 1.05-.11 1.54-.31.49-.21.93-.51 1.29-.89L100.48 3.17c.25-.27.43-.61.49-.97.06-.36.02-.74-.14-1.08-.15-.34-.39-.62-.71-.83C99.81.11 99.44 0 99.06 0H20.03c-.53 0-1.05.11-1.54.31-.49.21-.93.51-1.29.89L.52 18.62c-.25.27-.43.61-.49.97-.06.36-.02.74.14 1.08.15.34.39.62.71.83.31.2.68.31 1.06.29z"/>
    </svg>`;
  }

  // Extract dominant color from token image for dynamic glow effects
  async extractTokenColor(imageUrl) {
    // Check cache first
    if (this.tokenColorCache.has(imageUrl)) {
      return this.tokenColorCache.get(imageUrl);
    }

    // Default fallback colors (orange theme)
    const defaultColors = {
      glow: 'rgba(255, 140, 0, 0.1)',
      overlay: 'rgba(255, 140, 0, 0.15)',
      border: 'rgba(255, 140, 0, 0.25)',
      primary: '#ff8c00'
    };

    if (!imageUrl) {
      return defaultColors;
    }

    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';

      const colorPromise = new Promise((resolve) => {
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = 50;
            canvas.height = 50;
            ctx.drawImage(img, 0, 0, 50, 50);

            const imageData = ctx.getImageData(10, 10, 30, 30);
            const pixels = imageData.data;

            let r = 0, g = 0, b = 0, count = 0;
            for (let i = 0; i < pixels.length; i += 4) {
              const alpha = pixels[i + 3];
              if (alpha > 128) {
                r += pixels[i];
                g += pixels[i + 1];
                b += pixels[i + 2];
                count++;
              }
            }

            if (count === 0) {
              resolve(defaultColors);
              return;
            }

            r = Math.round(r / count);
            g = Math.round(g / count);
            b = Math.round(b / count);

            const brightness = (r * 299 + g * 587 + b * 114) / 1000;
            const intensity = brightness > 180 ? 0.08 : brightness > 120 ? 0.12 : 0.18;

            const colors = {
              glow: `rgba(${r}, ${g}, ${b}, ${intensity})`,
              overlay: `rgba(${r}, ${g}, ${b}, ${intensity * 1.5})`,
              border: `rgba(${r}, ${g}, ${b}, ${0.25})`,
              primary: `rgb(${r}, ${g}, ${b})`,
              brightness: brightness
            };

            this.tokenColorCache.set(imageUrl, colors);
            this.saveTokenColors();
            resolve(colors);
          } catch (e) {
            console.warn('Color extraction failed:', e);
            resolve(defaultColors);
          }
        };

        img.onerror = () => resolve(defaultColors);
        setTimeout(() => resolve(defaultColors), 2000);
      });

      img.src = imageUrl;
      return await colorPromise;

    } catch (e) {
      console.warn('Token color extraction error:', e);
      return defaultColors;
    }
  }

  saveTokenColors() {
    const colorsObj = Object.fromEntries(this.tokenColorCache);
    try {
      localStorage.setItem('dexterTokenColors', JSON.stringify(colorsObj));
    } catch (e) {
      console.warn('Failed to save token colors:', e);
    }
  }

  showError(message) {
    this.tokenContainer.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text" style="color: #f87171;">${message}</div></div>`;
  }

  // Update header new arrivals section
  async updateHeaderArrivals() {
    try {
      // Fetch both Degen and Holder tokens for arrivals
      const [degenResponse, holderResponse] = await Promise.all([
        fetch(`${API_BASE}/tokens/top?viewMode=${currentViewMode}`),
        fetch(`${API_BASE}/tokens/holder?viewMode=${currentViewMode}`)
      ]);

      let degenTokens = [];
      let holderTokens = [];

      if (degenResponse.ok) {
        const data = await degenResponse.json();
        degenTokens = data.top10 || [];
      }

      if (holderResponse.ok) {
        const data = await holderResponse.json();
        holderTokens = data.tokens || [];
      }

      // Update Degen section
      this.renderArrivalsMode('degen', degenTokens);
      // Update Holder section
      this.renderArrivalsMode('holder', holderTokens);

    } catch (error) {
      console.log('Failed to update arrivals:', error);
    }
  }

  renderArrivalsMode(mode, tokens) {
    const tokensContainer = document.getElementById(`arrivals-${mode}-tokens`);
    const countElement = document.getElementById(`arrivals-${mode}-count`);

    // Update the count in the sidebar
    if (countElement) {
      countElement.textContent = tokens.length;
    }

    if (!tokensContainer) return;

    // Sort by spottedAt (most recent first) and take top 5
    const recentTokens = [...tokens]
      .sort((a, b) => b.spottedAt - a.spottedAt)
      .slice(0, 5);

    if (recentTokens.length === 0) {
      tokensContainer.innerHTML = `<span class="arrivals-empty">awaiting signals...</span>`;
      return;
    }

    const tokensHtml = recentTokens.map((token, index) => {
      const symbol = token.symbol || token.name?.substring(0, 3).toUpperCase() || '???';
      const mc = this.formatCurrency(token.currentMc);
      const iconLetter = symbol.charAt(0);
      const logoUrl = token.logoUrl || token.image;
      const orderLabel = String(index + 1).padStart(2, '0');

      // Generate icon HTML - use image if available, otherwise fallback letter
      let iconHtml;
      if (logoUrl) {
        iconHtml = `
          <img
            src="${logoUrl}"
            alt="${symbol}"
            class="arrivals-token-icon"
            onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
          />
          <span class="arrivals-token-icon-fallback" style="display:none;">${iconLetter}</span>
        `;
      } else {
        iconHtml = `<span class="arrivals-token-icon-fallback">${iconLetter}</span>`;
      }

      // Calculate 1-minute change
      let oneMinChange = 0;
      let changeClass = '';
      let changeArrow = '';

      if (token.mcTenSecondsAgo && token.mcTenSecondsAgo > 0) {
        const estimatedChange = (token.currentMc - token.mcTenSecondsAgo) * 6;
        oneMinChange = (estimatedChange / token.mcTenSecondsAgo) * 100;

        if (oneMinChange > 0) {
          changeClass = 'positive';
          changeArrow = '▲';
        } else if (oneMinChange < 0) {
          changeClass = 'negative';
          changeArrow = '▼';
        }
      }

      const changeDisplay = Math.abs(oneMinChange).toFixed(0);

      // Calculate time ago in minutes
      const minutesAgo = Math.floor((Date.now() - token.spottedAt) / 60000);
      const timeAgoDisplay = minutesAgo < 1 ? '<1m' : `${minutesAgo}m`;

      return `
        <div class="arrivals-token ${mode}" data-address="${token.contractAddress}">
          <span class="arrivals-token-order">${orderLabel}</span>
          <div class="arrivals-token-icon-wrapper">
            ${iconHtml}
          </div>
          <span class="arrivals-token-symbol arrivals-ticker-copy" data-ca="${token.contractAddress}">${symbol}</span>
          <div class="arrivals-token-info">
            <span class="arrivals-token-mc">${mc}</span>
            ${changeClass ? `
              <span class="arrivals-token-change ${changeClass}" title="1-min momentum">
                <span class="arrivals-token-change-arrow">${changeArrow}</span>${changeDisplay}%
              </span>
            ` : ''}
          </div>
          <span class="arrivals-token-time">${timeAgoDisplay}</span>
        </div>
      `;
    }).join('');

    tokensContainer.innerHTML = tokensHtml;
  }

  async runMcTest() {
    const newWindow = window.open('', 'MC Test', 'width=600,height=500');

    if (!newWindow) {
      alert('Please allow popups to use MC Test');
      return;
    }

    newWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Market Cap Test</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: 'Courier New', monospace;
            background: #1a1a1a;
            color: #e0e0e0;
            padding: 20px;
          }
          h1 {
            font-size: 18px;
            color: #ff8c00;
            margin-bottom: 20px;
            text-align: center;
          }
          .input-section {
            margin-bottom: 20px;
            background: #2a2a2a;
            padding: 15px;
            border-radius: 8px;
          }
          label {
            display: block;
            font-size: 12px;
            color: #888;
            margin-bottom: 8px;
            text-transform: uppercase;
          }
          input {
            width: 100%;
            padding: 10px;
            font-family: 'Courier New', monospace;
            font-size: 12px;
            background: #1a1a1a;
            border: 1px solid #444;
            color: #fff;
            border-radius: 4px;
          }
          input:focus {
            outline: none;
            border-color: #ff8c00;
          }
          button {
            width: 100%;
            padding: 12px;
            margin-top: 10px;
            font-family: 'Courier New', monospace;
            font-size: 14px;
            font-weight: 700;
            background: #ff8c00;
            color: #1a1a1a;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            transition: all 0.2s ease;
          }
          button:hover:not(:disabled) {
            background: #ffa500;
            transform: translateY(-1px);
          }
          button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }
          .console {
            background: #0a0a0a;
            border: 1px solid #333;
            border-radius: 8px;
            padding: 15px;
            height: 300px;
            overflow-y: auto;
            font-size: 11px;
          }
          .console-line {
            margin-bottom: 8px;
            line-height: 1.6;
          }
          .console-timestamp {
            color: #666;
            margin-right: 8px;
          }
          .console-mc {
            color: #ff8c00;
            font-weight: 700;
          }
          .console-error {
            color: #f87171;
          }
          .console-success {
            color: #4ade80;
          }
          .status {
            text-align: center;
            font-size: 11px;
            color: #888;
            margin-top: 10px;
          }
        </style>
      </head>
      <body>
        <h1>MARKET CAP TEST</h1>
        <div class="input-section">
          <label>Contract Address</label>
          <input type="text" id="address-input" placeholder="Enter Solana token contract address..." />
          <button id="run-btn">Run Test (5 checks @ 2s intervals)</button>
        </div>
        <div class="console" id="console"></div>
        <div class="status" id="status">Enter a contract address and click Run Test</div>
      </body>
      </html>
    `);

    const consoleEl = newWindow.document.getElementById('console');
    const statusEl = newWindow.document.getElementById('status');
    const runBtn = newWindow.document.getElementById('run-btn');
    const addressInput = newWindow.document.getElementById('address-input');

    const log = (message, type = 'normal') => {
      const timestamp = new Date().toLocaleTimeString();
      const line = newWindow.document.createElement('div');
      line.className = 'console-line';

      let className = '';
      if (type === 'error') className = 'console-error';
      if (type === 'success') className = 'console-success';

      line.innerHTML = `<span class="console-timestamp">[${timestamp}]</span><span class="${className}">${message}</span>`;
      consoleEl.appendChild(line);
      consoleEl.scrollTop = consoleEl.scrollHeight;
    };

    runBtn.addEventListener('click', async () => {
      const address = addressInput.value.trim();

      if (!address) {
        log('ERROR: Please enter a contract address', 'error');
        return;
      }

      runBtn.disabled = true;
      addressInput.disabled = true;
      consoleEl.innerHTML = '';

      log('Starting MC test...', 'success');
      log(`Token: ${address}`);
      log('Running 5 checks at 2-second intervals...');
      statusEl.textContent = 'Test in progress...';

      try {
        let checkCount = 0;
        const maxChecks = 5;

        const runCheck = async () => {
          checkCount++;
          log(`--- Check ${checkCount}/${maxChecks} ---`);

          try {
            const response = await fetch(`${API_BASE}/test/mc-check`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ address })
            });

            if (!response.ok) {
              throw new Error('API request failed');
            }

            const data = await response.json();

            if (data.success && data.marketCap !== null) {
              log(`Market Cap: <span class="console-mc">${data.formattedMc}</span>`);
            } else {
              log('No market cap data returned', 'error');
            }
          } catch (error) {
            log(`Error: ${error.message}`, 'error');
          }

          if (checkCount < maxChecks) {
            setTimeout(runCheck, 2000);
          } else {
            log('Test complete!', 'success');
            statusEl.textContent = 'Test complete';
            runBtn.disabled = false;
            addressInput.disabled = false;
          }
        };

        runCheck();
      } catch (error) {
        log(`Fatal error: ${error.message}`, 'error');
        statusEl.textContent = 'Test failed';
        runBtn.disabled = false;
        addressInput.disabled = false;
      }
    });
  }

  async runPurge() {
    const btn = document.getElementById('purge-btn');

    if (!confirm('Are you sure you want to purge DEGEN tokens? This will NOT affect Holder tokens.')) {
      return;
    }

    btn.disabled = true;
    btn.classList.add('purging');
    btn.textContent = '⏳ Purging...';

    try {
      const response = await fetch(`${API_BASE}/purge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        throw new Error('Failed to purge data');
      }

      currentTopTokens = [];
      previousTokenData = {};
      lastRenderedData = null;

      btn.textContent = '✅ Purged!';
      btn.style.color = '#4ade80';

      setTimeout(() => {
        btn.disabled = false;
        btn.classList.remove('purging');
        btn.textContent = '🗑️ Purge';
        btn.style.color = '';
      }, 2000);

      await this.fetchTokens();
    } catch (error) {
      console.error('Purge error:', error);
      btn.textContent = '❌ Failed';
      setTimeout(() => {
        btn.disabled = false;
        btn.classList.remove('purging');
        btn.textContent = '🗑️ Purge';
      }, 2000);
    }
  }

  openCheckTokensWindow() {
    const newWindow = window.open('', 'Check Tokens', 'width=700,height=800');

    if (!newWindow) {
      alert('Please allow popups to view all tracked tokens');
      return;
    }

    newWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>All Tracked Tokens</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: 'Courier New', monospace;
            background: #1a1a1a;
            color: #e0e0e0;
            padding: 20px;
          }
          h1 {
            font-size: 18px;
            color: #ff8c00;
            margin-bottom: 20px;
            text-align: center;
          }
          .count {
            font-size: 12px;
            color: #888;
            text-align: center;
            margin-bottom: 15px;
          }
          .headers {
            display: flex;
            justify-content: space-between;
            padding: 8px 12px;
            background: #333;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 700;
            color: #ff8c00;
            margin-bottom: 10px;
            text-transform: uppercase;
          }
          .header-item {
            cursor: pointer;
            user-select: none;
            transition: color 0.2s ease;
          }
          .header-item:hover {
            color: #ffa500;
          }
          .header-ticker { flex: 1; }
          .header-spotted { width: 110px; text-align: right; }
          .header-time { width: 70px; text-align: center; }
          .header-current { width: 120px; text-align: right; }
          .header-change { width: 90px; text-align: right; }
          .header-peak { width: 70px; text-align: right; }
          .token-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
          }
          .token-row {
            display: flex;
            justify-content: space-between;
            padding: 8px 12px;
            background: #2a2a2a;
            border-radius: 4px;
            font-size: 11px;
            border-left: 3px solid #444;
          }
          .token-row:hover {
            background: #333;
          }
          .ticker {
            color: #fff;
            font-weight: 700;
            flex: 1;
          }
          .spotted {
            color: #4ade80;
            font-weight: 700;
            width: 110px;
            text-align: right;
          }
          .current {
            color: #ff8c00;
            font-weight: 700;
            width: 120px;
            text-align: right;
          }
          .time {
            color: #888;
            width: 70px;
            text-align: center;
          }
          .change {
            font-weight: 700;
            width: 100px;
            text-align: right;
          }
          .change.positive { color: #4ade80; }
          .change.negative { color: #f87171; }
          .multiplier {
            color: #ff8c00;
            font-weight: 700;
            width: 70px;
            text-align: right;
          }
          .loading {
            text-align: center;
            color: #888;
            padding: 40px;
          }
          .sort-arrow {
            font-size: 10px;
            margin-left: 4px;
          }
        </style>
      </head>
      <body>
        <h1>ALL TRACKED TOKENS</h1>
        <div class="count" id="count">Loading...</div>
        <div class="headers">
          <span class="header-item header-ticker" data-sort="ticker">Ticker <span class="sort-arrow"></span></span>
          <span class="header-item header-spotted" data-sort="spotted">Spotted <span class="sort-arrow"></span></span>
          <span class="header-item header-time" data-sort="time">Time <span class="sort-arrow"></span></span>
          <span class="header-item header-current" data-sort="current">Current MC <span class="sort-arrow"></span></span>
          <span class="header-item header-change" data-sort="change">Change <span class="sort-arrow"></span></span>
          <span class="header-item header-peak" data-sort="peak">Peak <span class="sort-arrow">▼</span></span>
        </div>
        <div class="token-list" id="token-list">
          <div class="loading">Fetching tokens...</div>
        </div>
      </body>
      </html>
    `);

    let lastSort = { key: 'peak', asc: false };
    let tokensData = [];

    const renderTokens = () => {
      const listEl = newWindow.document.getElementById('token-list');
      const sorted = [...tokensData].sort((a, b) => {
        let valA, valB;
        switch(lastSort.key) {
          case 'ticker':
            valA = a.ticker.toLowerCase();
            valB = b.ticker.toLowerCase();
            return lastSort.asc ? valA.localeCompare(valB) : valB.localeCompare(valA);
          case 'spotted':
            valA = a.spottedMc || 0;
            valB = b.spottedMc || 0;
            break;
          case 'current':
            valA = a.currentMc || 0;
            valB = b.currentMc || 0;
            break;
          case 'time':
            valA = Date.now() - a.spottedAt;
            valB = Date.now() - b.spottedAt;
            break;
          case 'change':
            valA = a.changePercent;
            valB = b.changePercent;
            break;
          case 'peak':
          default:
            valA = a.peakMultiplier;
            valB = b.peakMultiplier;
            break;
        }
        if (valA === undefined) valA = 0;
        if (valB === undefined) valB = 0;
        return lastSort.asc ? (valA > valB ? 1 : valA < valB ? -1 : 0) : (valA < valB ? 1 : valA > valB ? -1 : 0);
      });
      const html = sorted.map(token => {
        const changeClass = token.changePercent >= 0 ? 'positive' : 'negative';
        const changeSign = token.changePercent >= 0 ? '+' : '';
        return `
          <div class="token-row">
            <span class="ticker">${token.ticker}</span>
            <span class="spotted">${token.spottedFormatted}</span>
            <span class="time">${token.timeAgo}</span>
            <span class="current">${token.currentFormatted}</span>
            <span class="change ${changeClass}">${changeSign}${token.changePercent.toFixed(1)}%</span>
            <span class="multiplier">${token.peakText}</span>
          </div>
        `;
      }).join('');
      listEl.innerHTML = html;
      newWindow.document.querySelectorAll('.header-item').forEach(header => {
        const arrow = header.querySelector('.sort-arrow');
        if (arrow) {
          const sortType = header.getAttribute('data-sort');
          if (sortType === lastSort.key) {
            arrow.textContent = lastSort.asc ? '▲' : '▼';
          } else {
            arrow.textContent = '';
          }
        }
      });
    };

    let pollInterval = null;
    let timeInterval = null;

    const fetchAndRenderTokens = () => {
      fetch(`${API_BASE}/tokens/all`)
        .then(res => res.json())
        .then(data => {
          const tokens = data.tokens || [];
          const countEl = newWindow.document.getElementById('count');
          countEl.textContent = `Total: ${tokens.length} tokens`;
          if (tokens.length === 0) {
            newWindow.document.getElementById('token-list').innerHTML = '<div class="loading">No tokens tracked</div>';
            return;
          }
          tokensData = tokens.map(token => {
            const timeAgo = this.getTimeAgo(token.spottedAt);
            const spottedMc = token.spottedMc || 0;
            const currentMc = token.currentMc || 0;
            const peakMultiplier = token.peakMultiplier ?? token.multiplier ?? 0;
            const currentMultiplier = spottedMc > 0 ? (currentMc / spottedMc) : 0;
            const changePercent = (currentMultiplier - 1) * 100;
            const ticker = (token.symbol && token.symbol !== 'Unknown' && token.symbol !== 'UNKNOWN')
              ? token.symbol
              : (token.name || 'Unknown');
            const spottedFormatted = this.formatCurrency(spottedMc);
            const currentFormatted = this.formatCurrency(currentMc);
            return {
              ticker,
              spottedAt: token.spottedAt,
              timeAgo,
              spottedMc,
              currentMc,
              peakMultiplier,
              peakText: Number(peakMultiplier).toFixed(2) + 'x',
              changePercent,
              spottedFormatted,
              currentFormatted
            };
          });
          renderTokens();
        })
        .catch(err => {
          console.error('Failed to fetch tokens:', err);
          const listEl = newWindow.document.getElementById('token-list');
          listEl.innerHTML = '<div class="loading">Failed to load tokens</div>';
        });
    };

    const setupHeaderSortListeners = () => {
      newWindow.document.querySelectorAll('.header-item').forEach(header => {
        header.addEventListener('click', () => {
          const sortType = header.getAttribute('data-sort');
          if (lastSort.key === sortType) {
            lastSort.asc = !lastSort.asc;
          } else {
            lastSort.key = sortType;
            lastSort.asc = false;
          }
          renderTokens();
        });
      });
    };

    fetchAndRenderTokens();
    setupHeaderSortListeners();

    pollInterval = setInterval(() => {
      fetchAndRenderTokens();
    }, 2000);

    timeInterval = setInterval(() => {
      tokensData.forEach(token => {
        token.timeAgo = this.getTimeAgo(token.spottedAt);
      });
      renderTokens();
    }, 500);

    newWindow.addEventListener('beforeunload', () => {
      clearInterval(pollInterval);
      clearInterval(timeInterval);
    });
  }

  openTelegramTokensWindow() {
    const newWindow = window.open('', 'Telegram Tokens', 'width=800,height=600');

    if (!newWindow) {
      alert('Please allow popups to view telegram tokens');
      return;
    }

    const telegramEnabled = this.telegramAutoAlert;
    const publicEnabled = this.publicChannelsEnabled;

    newWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Telegram Tokens</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: 'Courier New', monospace;
            background: #1a1a1a;
            color: #e0e0e0;
            padding: 20px;
          }
          h1 {
            font-size: 18px;
            color: #29a9eb;
            margin-bottom: 15px;
            text-align: center;
          }
          .settings-bar {
            display: flex;
            justify-content: center;
            gap: 20px;
            padding: 12px;
            background: #252528;
            border-radius: 6px;
            margin-bottom: 15px;
            border: 1px solid rgba(255, 255, 255, 0.06);
          }
          .toggle-item {
            display: flex;
            align-items: center;
            gap: 8px;
            cursor: pointer;
            user-select: none;
          }
          .toggle-checkbox {
            width: 16px;
            height: 16px;
            border: 1px solid #888;
            border-radius: 3px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
          }
          .toggle-item.active .toggle-checkbox {
            background: #29a9eb;
            border-color: #29a9eb;
          }
          .toggle-checkbox::after {
            content: '✓';
            font-size: 10px;
            color: #1a1a1a;
            opacity: 0;
          }
          .toggle-item.active .toggle-checkbox::after {
            opacity: 1;
          }
          .toggle-text {
            font-size: 11px;
            color: #aaa;
            text-transform: lowercase;
          }
          .toggle-item.active .toggle-text {
            color: #29a9eb;
          }
          .toggle-item:hover .toggle-text {
            color: #fff;
          }
          .count {
            font-size: 12px;
            color: #888;
            text-align: center;
            margin-bottom: 15px;
          }
          .headers {
            display: flex;
            justify-content: space-between;
            padding: 8px 12px;
            background: #333;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 700;
            color: #29a9eb;
            margin-bottom: 10px;
            text-transform: uppercase;
          }
          .header-item {
            cursor: pointer;
            user-select: none;
            transition: color 0.2s ease;
          }
          .header-item:hover {
            color: #1e90d0;
          }
          .header-ticker { flex: 1; }
          .header-time { width: 100px; text-align: center; }
          .header-type { width: 70px; text-align: center; }
          .header-peak { width: 70px; text-align: right; }
          .header-current { width: 110px; text-align: right; }
          .header-change { width: 90px; text-align: right; }
          .token-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
          }
          .token-row {
            display: flex;
            justify-content: space-between;
            padding: 8px 12px;
            background: #2a2a2a;
            border-radius: 4px;
            font-size: 11px;
            border-left: 3px solid #29a9eb;
          }
          .token-row:hover {
            background: #333;
          }
          .token-row.auto {
            border-left-color: #4ade80;
          }
          .token-row.manual {
            border-left-color: #ffa500;
          }
          .ticker {
            color: #fff;
            font-weight: 700;
            flex: 1;
          }
          .time {
            color: #888;
            width: 100px;
            text-align: center;
          }
          .type {
            font-weight: 700;
            width: 70px;
            text-align: center;
          }
          .type.auto { color: #4ade80; }
          .type.manual { color: #ffa500; }
          .peak {
            color: #ff8c00;
            font-weight: 700;
            width: 70px;
            text-align: right;
          }
          .current {
            color: #29a9eb;
            font-weight: 700;
            width: 110px;
            text-align: right;
          }
          .change {
            font-weight: 700;
            width: 90px;
            text-align: right;
          }
          .change.positive { color: #4ade80; }
          .change.negative { color: #f87171; }
          .loading {
            text-align: center;
            color: #888;
            padding: 40px;
          }
          .sort-arrow {
            font-size: 10px;
            margin-left: 4px;
          }
        </style>
      </head>
      <body>
        <h1>TELEGRAM ANNOUNCED TOKENS</h1>
        <div class="settings-bar">
          <div class="toggle-item ${telegramEnabled ? 'active' : ''}" id="telegram-toggle">
            <div class="toggle-checkbox"></div>
            <span class="toggle-text">telegram-alerts</span>
          </div>
          <div class="toggle-item ${publicEnabled ? 'active' : ''}" id="public-toggle">
            <div class="toggle-checkbox"></div>
            <span class="toggle-text">public-channels</span>
          </div>
        </div>
        <div class="count" id="count">Loading...</div>
        <div class="headers">
          <span class="header-item header-ticker" data-sort="ticker">Token <span class="sort-arrow"></span></span>
          <span class="header-item header-time" data-sort="time">Announced <span class="sort-arrow">▼</span></span>
          <span class="header-item header-type" data-sort="type">Type <span class="sort-arrow"></span></span>
          <span class="header-item header-peak" data-sort="peak">Peak <span class="sort-arrow"></span></span>
          <span class="header-item header-current" data-sort="current">Current MC <span class="sort-arrow"></span></span>
          <span class="header-item header-change" data-sort="change">1m Δ <span class="sort-arrow"></span></span>
        </div>
        <div class="token-list" id="token-list">
          <div class="loading">Fetching telegram tokens...</div>
        </div>
      </body>
      </html>
    `);

    let lastSort = { key: 'time', asc: false };
    let tokensData = [];

    const renderTokens = () => {
      const listEl = newWindow.document.getElementById('token-list');
      const sorted = [...tokensData].sort((a, b) => {
        let valA, valB;
        switch(lastSort.key) {
          case 'ticker':
            valA = a.ticker.toLowerCase();
            valB = b.ticker.toLowerCase();
            return lastSort.asc ? valA.localeCompare(valB) : valB.localeCompare(valA);
          case 'time':
            valA = a.announcedAt;
            valB = b.announcedAt;
            break;
          case 'type':
            valA = a.isAuto ? 1 : 0;
            valB = b.isAuto ? 1 : 0;
            break;
          case 'peak':
            valA = a.peakMultiplier;
            valB = b.peakMultiplier;
            break;
          case 'current':
            valA = a.currentMc || 0;
            valB = b.currentMc || 0;
            break;
          case 'change':
            valA = a.change1m;
            valB = b.change1m;
            break;
          default:
            valA = 0;
            valB = 0;
        }
        if (valA === undefined) valA = 0;
        if (valB === undefined) valB = 0;
        return lastSort.asc ? (valA > valB ? 1 : valA < valB ? -1 : 0) : (valA < valB ? 1 : valA > valB ? -1 : 0);
      });
      const html = sorted.map(token => {
        const changeClass = token.change1m >= 0 ? 'positive' : 'negative';
        const changeSign = token.change1m >= 0 ? '+' : '';
        const rowClass = token.isAuto ? 'auto' : 'manual';
        const typeText = token.isAuto ? 'Auto' : 'Manual';
        const typeClass = token.isAuto ? 'auto' : 'manual';
        return `
          <div class="token-row ${rowClass}">
            <span class="ticker">${token.ticker}</span>
            <span class="time">${token.timeAgo}</span>
            <span class="type ${typeClass}">${typeText}</span>
            <span class="peak">${token.peakText}</span>
            <span class="current">${token.currentFormatted}</span>
            <span class="change ${changeClass}">${changeSign}${token.change1m.toFixed(1)}%</span>
          </div>
        `;
      }).join('');
      listEl.innerHTML = html;
      newWindow.document.querySelectorAll('.header-item').forEach(header => {
        const arrow = header.querySelector('.sort-arrow');
        if (arrow) {
          const sortType = header.getAttribute('data-sort');
          if (sortType === lastSort.key) {
            arrow.textContent = lastSort.asc ? '▲' : '▼';
          } else {
            arrow.textContent = '';
          }
        }
      });
    };

    let pollInterval = null;
    let timeInterval = null;

    const fetchAndRenderTokens = () => {
      fetch(`${API_BASE}/telegram/announced`)
        .then(res => res.json())
        .then(data => {
          const tokens = data.tokens || [];
          const countEl = newWindow.document.getElementById('count');
          countEl.textContent = `Total: ${tokens.length} tokens`;
          if (tokens.length === 0) {
            newWindow.document.getElementById('token-list').innerHTML = '<div class="loading">No tokens announced yet</div>';
            return;
          }
          tokensData = tokens.map(token => {
            const timeAgo = this.getTimeAgo(token.announcedAt);
            const ticker = (token.symbol && token.symbol !== 'Unknown' && token.symbol !== 'UNKNOWN')
              ? token.symbol
              : (token.name || 'Unknown');
            const peakText = Number(token.peakMultiplier).toFixed(2) + 'x';
            const currentFormatted = this.formatCurrency(token.currentMc);
            return {
              ticker,
              announcedAt: token.announcedAt,
              timeAgo,
              isAuto: token.isAuto,
              peakMultiplier: token.peakMultiplier,
              peakText,
              currentMc: token.currentMc,
              currentFormatted,
              change1m: token.change1m || 0
            };
          });
          renderTokens();
        })
        .catch(err => {
          console.error('Failed to fetch telegram tokens:', err);
          const listEl = newWindow.document.getElementById('token-list');
          listEl.innerHTML = '<div class="loading">Failed to load telegram tokens</div>';
        });
    };

    const setupHeaderSortListeners = () => {
      newWindow.document.querySelectorAll('.header-item').forEach(header => {
        header.addEventListener('click', () => {
          const sortType = header.getAttribute('data-sort');
          if (lastSort.key === sortType) {
            lastSort.asc = !lastSort.asc;
          } else {
            lastSort.key = sortType;
            lastSort.asc = false;
          }
          renderTokens();
        });
      });
    };

    fetchAndRenderTokens();
    setupHeaderSortListeners();

    pollInterval = setInterval(() => {
      fetchAndRenderTokens();
    }, 2000);

    timeInterval = setInterval(() => {
      tokensData.forEach(token => {
        token.timeAgo = this.getTimeAgo(token.announcedAt);
      });
      renderTokens();
    }, 500);

    // Setup toggle listeners
    const telegramToggle = newWindow.document.getElementById('telegram-toggle');
    const publicToggle = newWindow.document.getElementById('public-toggle');

    if (telegramToggle) {
      telegramToggle.addEventListener('click', async () => {
        const newState = !this.telegramAutoAlert;
        this.telegramAutoAlert = newState;
        localStorage.setItem('telegramAutoAlert', newState.toString());

        const checkbox = document.getElementById('telegram-auto-alert-checkbox');
        if (checkbox) checkbox.checked = newState;

        telegramToggle.classList.toggle('active', newState);
        await this.syncTelegramMessagingToBackend();

        // Update public toggle state
        if (!newState && this.publicChannelsEnabled) {
          this.publicChannelsEnabled = false;
          localStorage.setItem('publicChannelsEnabled', 'false');
          const publicCheckbox = document.getElementById('public-channels-checkbox');
          if (publicCheckbox) publicCheckbox.checked = false;
          if (publicToggle) publicToggle.classList.remove('active');
          await this.syncPublicChannelsToBackend();
        }
      });
    }

    if (publicToggle) {
      publicToggle.addEventListener('click', async () => {
        if (!this.telegramAutoAlert) {
          alert('Enable telegram-alerts first');
          return;
        }
        const newState = !this.publicChannelsEnabled;
        this.publicChannelsEnabled = newState;
        localStorage.setItem('publicChannelsEnabled', newState.toString());

        const checkbox = document.getElementById('public-channels-checkbox');
        if (checkbox) checkbox.checked = newState;

        publicToggle.classList.toggle('active', newState);
        await this.syncPublicChannelsToBackend();
      });
    }

    newWindow.addEventListener('beforeunload', () => {
      clearInterval(pollInterval);
      clearInterval(timeInterval);
    });
  }

  openTelegramLoginModal() {
    const modalOverlay = document.getElementById('telegram-login-modal-overlay');
    if (modalOverlay) {
      modalOverlay.classList.add('visible');
      this.resetTelegramLoginModal();
    }
  }

  closeTelegramLoginModal() {
    const modalOverlay = document.getElementById('telegram-login-modal-overlay');
    if (modalOverlay) {
      modalOverlay.classList.remove('visible');
    }
  }

  resetTelegramLoginModal() {
    // Reset to step 1
    document.getElementById('tg-step-phone').classList.remove('hidden');
    document.getElementById('tg-step-code').classList.add('hidden');
    document.getElementById('tg-step-password').classList.add('hidden');

    // Clear inputs
    document.getElementById('tg-phone-input').value = '';
    document.getElementById('tg-code-input').value = '';
    document.getElementById('tg-password-input').value = '';

    // Clear status
    document.getElementById('tg-login-status').textContent = '';
    document.getElementById('tg-login-status').className = 'telegram-login-status';

    // Load saved phone number
    fetch(`${API_BASE}/telegram/phone`)
      .then(res => res.json())
      .then(data => {
        if (data.success && data.phone) {
          document.getElementById('tg-phone-input').value = data.phone;
        }
      })
      .catch(err => console.error('Failed to load phone number:', err));
  }

  setTelegramLoginStatus(message, type) {
    const statusEl = document.getElementById('tg-login-status');
    statusEl.textContent = message;
    statusEl.className = 'telegram-login-status ' + type;
  }

  setupTelegramLoginModal() {
    const closeBtn = document.getElementById('close-telegram-login');
    const cancelBtn = document.getElementById('tg-cancel-btn');
    const requestBtn = document.getElementById('tg-request-btn');
    const verifyBtn = document.getElementById('tg-verify-btn');
    const passwordBtn = document.getElementById('tg-password-btn');

    const closeModal = () => this.closeTelegramLoginModal();

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

    // Step 1: Request code
    if (requestBtn) {
      requestBtn.addEventListener('click', async () => {
        const phone = document.getElementById('tg-phone-input').value.trim();
        if (!phone) {
          this.setTelegramLoginStatus('Please enter a phone number', 'error');
          return;
        }

        requestBtn.disabled = true;
        this.setTelegramLoginStatus('Sending verification code...', 'info');

        try {
          const response = await fetch(`${API_BASE}/telegram/auth/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone })
          });
          const data = await response.json();

          if (data.success) {
            document.getElementById('tg-step-phone').classList.add('hidden');
            document.getElementById('tg-step-code').classList.remove('hidden');
            this.setTelegramLoginStatus(`Code sent to ${data.phone}`, 'success');
            document.getElementById('tg-code-input').focus();
          } else {
            this.setTelegramLoginStatus(`Error: ${data.error}`, 'error');
            requestBtn.disabled = false;
          }
        } catch (err) {
          this.setTelegramLoginStatus(`Error: ${err.message}`, 'error');
          requestBtn.disabled = false;
        }
      });
    }

    // Step 2: Verify code
    if (verifyBtn) {
      verifyBtn.addEventListener('click', async () => {
        const code = document.getElementById('tg-code-input').value.trim();
        if (!code) {
          this.setTelegramLoginStatus('Please enter verification code', 'error');
          return;
        }

        verifyBtn.disabled = true;
        this.setTelegramLoginStatus('Verifying...', 'info');

        try {
          const response = await fetch(`${API_BASE}/telegram/auth/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code })
          });
          const data = await response.json();

          if (data.success) {
            this.setTelegramLoginStatus('Authenticated successfully!', 'success');
            setTimeout(() => {
              this.closeTelegramLoginModal();
              // Refresh telegram status
              this.fetchAnnouncedTokens();
            }, 1500);
          } else if (data.status === 'needs_password') {
            document.getElementById('tg-step-code').classList.add('hidden');
            document.getElementById('tg-step-password').classList.remove('hidden');
            this.setTelegramLoginStatus('Enter your 2FA password', 'info');
            document.getElementById('tg-password-input').focus();
            verifyBtn.disabled = false;
          } else {
            this.setTelegramLoginStatus(`Error: ${data.error}`, 'error');
            verifyBtn.disabled = false;
          }
        } catch (err) {
          this.setTelegramLoginStatus(`Error: ${err.message}`, 'error');
          verifyBtn.disabled = false;
        }
      });
    }

    // Step 3: 2FA password
    if (passwordBtn) {
      passwordBtn.addEventListener('click', async () => {
        const code = document.getElementById('tg-code-input').value.trim();
        const password = document.getElementById('tg-password-input').value;
        if (!password) {
          this.setTelegramLoginStatus('Please enter 2FA password', 'error');
          return;
        }

        passwordBtn.disabled = true;
        this.setTelegramLoginStatus('Verifying password...', 'info');

        try {
          const response = await fetch(`${API_BASE}/telegram/auth/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, password })
          });
          const data = await response.json();

          if (data.success) {
            this.setTelegramLoginStatus('Authenticated successfully!', 'success');
            setTimeout(() => {
              this.closeTelegramLoginModal();
              // Refresh telegram status
              this.fetchAnnouncedTokens();
            }, 1500);
          } else {
            this.setTelegramLoginStatus(`Error: ${data.error}`, 'error');
            passwordBtn.disabled = false;
          }
        } catch (err) {
          this.setTelegramLoginStatus(`Error: ${err.message}`, 'error');
          passwordBtn.disabled = false;
        }
      });
    }
  }

  openIgnoreListWindow() {
    const newWindow = window.open('', 'Ignore List', 'width=400,height=500');

    if (!newWindow) {
      alert('Please allow popups to view the ignore list');
      return;
    }

    newWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Ignore List</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: 'JetBrains Mono', 'IBM Plex Mono', monospace;
            background: #0a0e1a;
            color: #e5e7eb;
            padding: 20px;
          }
          h1 {
            font-size: 16px;
            color: #ffb8c8;
            margin-bottom: 20px;
            text-align: center;
            letter-spacing: 2px;
          }
          .count {
            font-size: 11px;
            color: #9ca3af;
            text-align: center;
            margin-bottom: 15px;
          }
          .token-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
          }
          .token-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 12px;
            background: #111827;
            border-radius: 6px;
            border: 1px solid rgba(196, 167, 255, 0.15);
          }
          .ticker {
            color: #c4a7ff;
            font-weight: 600;
            font-size: 12px;
          }
          .undo-btn {
            background: transparent;
            border: 1px solid #b8ffd5;
            color: #b8ffd5;
            padding: 4px 10px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 10px;
            font-weight: 600;
            transition: all 0.2s ease;
          }
          .undo-btn:hover {
            background: #b8ffd5;
            color: #0a0e1a;
          }
          .loading {
            text-align: center;
            color: #6b7280;
            padding: 40px;
          }
          .empty {
            text-align: center;
            color: #4b5563;
            padding: 40px;
            font-size: 11px;
          }
        </style>
      </head>
      <body>
        <h1>IGNORED TOKENS</h1>
        <div class="count" id="count">Loading...</div>
        <div class="token-list" id="token-list">
          <div class="loading">Fetching ignore list...</div>
        </div>
      </body>
      </html>
    `);

    const fetchAndRender = () => {
      fetch(API_BASE + '/blacklist')
        .then(res => res.json())
        .then(data => {
          const blacklist = data.blacklist || [];
          const countEl = newWindow.document.getElementById('count');
          const listEl = newWindow.document.getElementById('token-list');

          countEl.textContent = 'Total: ' + blacklist.length + ' ignored';

          if (blacklist.length === 0) {
            listEl.innerHTML = '<div class="empty">No tokens in ignore list</div>';
            return;
          }

          const html = blacklist.map(token => {
            const name = token.name || 'Unknown';
            const addr = token.contractAddress;
            return '<div class="token-row" data-address="' + addr + '">' +
              '<span class="ticker">' + name + '</span>' +
              '<button class="undo-btn" data-address="' + addr + '" data-name="' + name + '">Undo</button>' +
              '</div>';
          }).join('');

          listEl.innerHTML = html;

          newWindow.document.querySelectorAll('.undo-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
              const address = btn.getAttribute('data-address');
              const name = btn.getAttribute('data-name');

              try {
                const response = await fetch(API_BASE + '/blacklist/' + encodeURIComponent(address), {
                  method: 'DELETE'
                });

                if (response.ok) {
                  const row = btn.closest('.token-row');
                  if (row) row.remove();

                  const remaining = newWindow.document.querySelectorAll('.token-row').length;
                  countEl.textContent = 'Total: ' + remaining + ' ignored';

                  if (remaining === 0) {
                    listEl.innerHTML = '<div class="empty">No tokens in ignore list</div>';
                  }

                  console.log('Removed from ignore list: ' + name);
                }
              } catch (err) {
                console.error('Failed to remove from ignore list:', err);
              }
            });
          });
        })
        .catch(err => {
          console.error('Failed to fetch ignore list:', err);
          newWindow.document.getElementById('token-list').innerHTML =
            '<div class="loading">Failed to load ignore list</div>';
        });
    };

    fetchAndRender();
  }

  openDataStatsWindow() {
    const newWindow = window.open('', 'Data Collector Stats', 'width=500,height=600');

    if (!newWindow) {
      alert('Please allow popups to view the data collector stats');
      return;
    }

    newWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Data Collector Stats</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: 'JetBrains Mono', 'IBM Plex Mono', monospace;
            background: #0a0e1a;
            color: #e5e7eb;
            padding: 20px;
          }
          h1 {
            font-size: 16px;
            color: #ff8c00;
            margin-bottom: 20px;
            text-align: center;
            letter-spacing: 2px;
          }
          .stats-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 15px;
            margin-bottom: 20px;
          }
          .stat-box {
            background: #111827;
            border: 1px solid rgba(255, 140, 0, 0.2);
            border-radius: 8px;
            padding: 15px;
          }
          .stat-label {
            font-size: 10px;
            color: #9ca3af;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 5px;
          }
          .stat-value {
            font-size: 18px;
            font-weight: 700;
            color: #ff8c00;
          }
          .stat-value.enabled {
            color: #4ade80;
          }
          .stat-value.disabled {
            color: #f87171;
          }
          .file-info {
            background: #111827;
            border: 1px solid rgba(196, 167, 255, 0.15);
            border-radius: 8px;
            padding: 15px;
            margin-bottom: 15px;
          }
          .file-info h2 {
            font-size: 12px;
            color: #c4a7ff;
            margin-bottom: 10px;
          }
          .file-info p {
            font-size: 10px;
            color: #9ca3af;
            line-height: 1.6;
          }
          .file-info a {
            color: #4ade80;
          }
          .actions {
            display: flex;
            gap: 10px;
            margin-top: 20px;
          }
          .btn {
            flex: 1;
            padding: 10px;
            border: none;
            border-radius: 6px;
            font-family: inherit;
            font-size: 11px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
          }
          .btn-refresh {
            background: #4ade80;
            color: #0a0e1a;
          }
          .btn-refresh:hover {
            background: #22c55e;
          }
          .btn-toggle {
            background: rgba(255, 140, 0, 0.2);
            border: 1px solid #ff8c00;
            color: #ff8c00;
          }
          .btn-toggle:hover {
            background: rgba(255, 140, 0, 0.3);
          }
          .btn-toggle.off {
            background: rgba(248, 113, 113, 0.2);
            border-color: #f87171;
            color: #f87171;
          }
          .loading {
            text-align: center;
            color: #6b7280;
            padding: 40px;
          }
          .error {
            background: rgba(248, 113, 113, 0.1);
            border: 1px solid #f87171;
            border-radius: 6px;
            padding: 15px;
            color: #fca5a5;
            font-size: 11px;
            margin-top: 15px;
          }
        </style>
      </head>
      <body>
        <h1>📊 DATA COLLECTOR</h1>

        <div id="stats-content">
          <div class="loading">Fetching stats...</div>
        </div>

        <div class="actions">
          <button class="btn btn-refresh" id="refresh-btn">REFRESH</button>
          <button class="btn btn-toggle" id="toggle-btn">TOGGLE</button>
        </div>
      </body>
      </html>
    `);

    const fetchAndRender = async () => {
      try {
        const response = await fetch(API_BASE + '/debug/data-collector');
        if (!response.ok) throw new Error('Failed to fetch stats');

        const stats = await response.json();
        const contentEl = newWindow.document.getElementById('stats-content');

        contentEl.innerHTML = `
          <div class="stats-grid">
            <div class="stat-box">
              <div class="stat-label">Status</div>
              <div class="stat-value ${stats.enabled ? 'enabled' : 'disabled'}">
                ${stats.enabled ? 'ACTIVE' : 'DISABLED'}
              </div>
            </div>
            <div class="stat-box">
              <div class="stat-label">Records in Buffer</div>
              <div class="stat-value">${stats.recordsInBuffer || 0}</div>
            </div>
            <div class="stat-box">
              <div class="stat-label">Total Records</div>
              <div class="stat-value">${stats.totalRecordsCollected || 0}</div>
            </div>
            <div class="stat-box">
              <div class="stat-label">Data Directory</div>
              <div class="stat-value" style="font-size: 11px; padding-top: 8px;">
                ${stats.dataDir || 'N/A'}
              </div>
            </div>
          </div>

          <div class="file-info">
            <h2>CURRENT FILE</h2>
            ${stats.currentFile
              ? `<p><strong>File:</strong> ${stats.currentFile}</p>
                 <p style="margin-top: 8px; color: #4ade80;">✓ Data is being recorded</p>`
              : `<p style="color: #f87171;">⚠ No active file - collection may not be working</p>`
            }
          </div>

          <div class="file-info">
            <h2>📁 DATA LOCATION</h2>
            <p>Data is saved to: <code>${stats.dataDir || 'src/data/scoring-logs/'}</code></p>
            <p style="margin-top: 8px;">See README.txt in that folder for analysis instructions.</p>
          </div>

          <div class="file-info">
            <h2>📖 HOW TO ANALYZE</h2>
            <p>1. Run for 1-2 days to collect data</p>
            <p>2. Open the JSON files in src/data/scoring-logs/</p>
            <p>3. Use the Python scripts in README.txt</p>
            <p>4. Analyze score vs multiplier correlation</p>
            <p>5. Optimize algorithm weights based on findings</p>
          </div>
        `;

        // Update toggle button
        const toggleBtn = newWindow.document.getElementById('toggle-btn');
        if (toggleBtn) {
          toggleBtn.textContent = stats.enabled ? 'DISABLE' : 'ENABLE';
          toggleBtn.className = 'btn btn-toggle' + (stats.enabled ? '' : ' off');
        }

      } catch (error) {
        const contentEl = newWindow.document.getElementById('stats-content');
        contentEl.innerHTML = `
          <div class="error">
            Failed to load stats: ${error.message}
          </div>
        `;
      }
    };

    // Refresh button
    const refreshBtn = newWindow.document.getElementById('refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', fetchAndRender);
    }

    // Toggle button
    const toggleBtn = newWindow.document.getElementById('toggle-btn');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', async () => {
        try {
          // Get current state
          const statsResponse = await fetch(API_BASE + '/debug/data-collector');
          const stats = await statsResponse.json();
          const newState = !stats.enabled;

          const response = await fetch(API_BASE + '/debug/data-collector/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: newState })
          });

          if (response.ok) {
            fetchAndRender(); // Refresh to show new state
          } else {
            alert('Failed to toggle data collection');
          }
        } catch (error) {
          alert('Error: ' + error.message);
        }
      });
    }

    // Initial fetch
    fetchAndRender();

    // Auto-refresh every 5 seconds
    const refreshInterval = setInterval(fetchAndRender, 5000);

    // Cleanup on window close
    newWindow.addEventListener('beforeunload', () => {
      clearInterval(refreshInterval);
    });
  }

  // ============================================================
  // RADAR MODE FUNCTIONS
  // ============================================================

  // Radar data caching to prevent unnecessary re-renders
  radarLastDegenData = null;
  radarLastHolderData = null;
  radarLastMVP = null;
  radarInitialRender = true;

  async renderRadarMode() {
    // Fetch separate data for MVP (holder) and Degen radars
    try {
      // Fetch degen tokens for Degen radar
      const degenResponse = await fetch(`${API_BASE}/tokens/top?viewMode=all-time`);
      if (!degenResponse.ok) throw new Error('Failed to fetch degen radar data');
      const degenData = await degenResponse.json();
      const degenTokens = degenData.top10 || [];

      // Fetch holder tokens for MVP radar (with fallback - may not be available)
      let holderTokens = [];
      let holderMvp = null;
      try {
        const holderResponse = await fetch(`${API_BASE}/tokens/holder`);
        if (holderResponse.ok) {
          const holderData = await holderResponse.json();
          holderTokens = holderData.tokens || [];
          holderMvp = holderData.mvp || null;
        }
      } catch (holderError) {
        console.warn('Holder API not available, using degen tokens for MVP radar:', holderError);
        // Use degen tokens as fallback
        holderTokens = degenTokens;
        holderMvp = degenData.mvp;
      }

      // Fallback: if no holder MVP but we have tokens, use the first holder token as center
      if (!holderMvp && holderTokens.length > 0) {
        holderMvp = holderTokens[0];
      }

      // Create data signatures for comparison
      const degenSignature = JSON.stringify({
        tokens: degenTokens.slice(0, 5).map(t => ({
          address: t.contractAddress,
          score: t.score
        }))
      });

      const holderSignature = JSON.stringify({
        tokens: holderTokens.slice(0, 5).map(t => ({
          address: t.contractAddress,
          rank: t.holderRank || t.rank,
          score: t.score
        })),
        mvpAddress: holderMvp?.contractAddress || holderMvp?.address,
        mvpScore: holderMvp?.score
      });

      // Only re-render if data changed
      if (degenSignature !== this.radarLastDegenData || holderSignature !== this.radarLastHolderData || this.radarInitialRender) {
        this.radarLastDegenData = degenSignature;
        this.radarLastHolderData = holderSignature;

        // Check for MVP changes and add log entry
        if (holderMvp && this.radarLastMVP !== (holderMvp.contractAddress || holderMvp.address) && !this.radarInitialRender) {
          this.addRadarLogEntry('radar-mvp-log', `$${holderMvp.symbol || holderMvp.name} is the new MVP!`, 'highlight');
        }
        this.radarLastMVP = holderMvp?.contractAddress || holderMvp?.address || null;

        // Check for degen token rank changes
        if (!this.radarInitialRender) {
          this.checkTokenChanges(degenTokens);
        }

        // Render MVP radar (holder tokens or fallback, MVP in center)
        this.renderRadarChart('radar-mvp-display', holderTokens, holderMvp, 'mvp');

        // Render Degen radar (degen tokens, top momentum score in center)
        const topMomentumToken = degenTokens.reduce((best, token) =>
          (token.momentumScore || 0) > (best?.momentumScore || 0) ? token : best, null);
        this.renderRadarChart('radar-degen-display', degenTokens, topMomentumToken, 'degen');

        this.radarInitialRender = false;
      }
    } catch (error) {
      console.error('Failed to fetch radar data:', error);
      const mvpDisplay = document.getElementById('radar-mvp-display');
      const degenDisplay = document.getElementById('radar-degen-display');
      if (mvpDisplay) {
        mvpDisplay.innerHTML = `
          <div class="radar-empty-state">
            <div class="radar-empty-icon">⚠</div>
            <div class="radar-empty-text">Failed to load radar data</div>
          </div>
        `;
      }
      if (degenDisplay) {
        degenDisplay.innerHTML = `
          <div class="radar-empty-state">
            <div class="radar-empty-icon">⚠</div>
            <div class="radar-empty-text">Failed to load radar data</div>
          </div>
        `;
      }
    }
  }

  checkTokenChanges(tokens) {
    const top5 = tokens.slice(0, 5);

    // Check for new high scores
    for (const token of top5) {
      const score = parseFloat(token.score) || 0;
      if (score > 80) {
        this.addRadarLogEntry('radar-mvp-log', `$${token.symbol || token.name} very high score: ${score.toFixed(1)}`, 'info');
      } else if (score > 60) {
        this.addRadarLogEntry('radar-mvp-log', `$${token.symbol || token.name} climbing fast!`, 'info');
      }
    }

    // Check for tokens moving up in rank
    const previousTop5 = this.previousRadarTop5 || [];
    for (let i = 0; i < top5.length; i++) {
      const token = top5[i];
      const prevIndex = previousTop5.findIndex(t => t.contractAddress === token.contractAddress);

      if (prevIndex > i && prevIndex !== -1) {
        this.addRadarLogEntry('radar-degen-log', `$${token.symbol || token.name} climbing to #${i + 1}!`, 'climbing');
      }
    }

    this.previousRadarTop5 = [...top5];
  }

  addRadarLogEntry(radarId, message, type = 'info') {
    const logContainer = document.getElementById(radarId);
    if (!logContainer) return;

    // Remove empty state if present
    const emptyEntry = logContainer.querySelector('.radar-log-empty');
    if (emptyEntry) emptyEntry.remove();

    // Create new log entry
    const entry = document.createElement('div');
    entry.className = `radar-log-entry radar-log-${type}`;
    entry.textContent = `> ${message}`;

    // Add timestamp
    const timestamp = document.createElement('span');
    timestamp.className = 'radar-log-timestamp';
    const now = new Date();
    timestamp.textContent = ` [${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}]`;
    entry.appendChild(timestamp);

    // Add to bottom (after existing entries)
    logContainer.appendChild(entry);

    // Remove old entries (keep max 5)
    const entries = logContainer.querySelectorAll('.radar-log-entry:not(.radar-log-empty)');
    while (entries.length > 5) {
      entries[0].remove();
    }

    // Auto-remove after 10 seconds
    setTimeout(() => {
      if (entry.parentNode) {
        entry.style.opacity = '0';
        entry.style.transform = 'translateY(-10px)';
        setTimeout(() => entry.remove(), 300);
      }
    }, 10000);
  }

  renderRadarChart(containerId, tokens, mvpToken, radarType) {
    const container = document.getElementById(containerId);
    if (!container) return;

    try {
      // Get center token (MVP for holder radar, top token for degen radar)
      const centerToken = mvpToken || tokens[0];

      console.log(`[Radar ${containerId}] tokens:`, tokens?.length, 'centerToken:', centerToken?.symbol, 'mvpToken:', mvpToken?.symbol);

    if (!tokens.length || !centerToken) {
      container.innerHTML = `
        <div class="radar-empty-state">
          <div class="radar-empty-icon">◎</div>
          <div class="radar-empty-text">No tokens available</div>
        </div>
      `;
      return;
    }

    // Helper to get token score (handles both degen tokens with score field and holder tokens)
    const getTokenScore = (token) => {
      if (token.score !== undefined) return parseFloat(token.score) || 0;
      // For holder tokens, use holderRank as inverse score (rank 1 = 100, rank 2 = 90, etc.)
      if (token.holderRank !== undefined) {
        return Math.max(0, 100 - ((token.holderRank - 1) * 10));
      }
      // Fallback to multiplier if available
      if (token.multiplier && typeof token.multiplier === 'number') {
        return Math.min(100, token.multiplier * 10);
      }
      return 50; // Default fallback
    };

    // Get center token's score for sizing calculation
    const centerScoreValue = getTokenScore(centerToken) || 1;

    // Get top 5 tokens EXCLUDING the center token
    const centerAddress = centerToken.contractAddress || centerToken.address || '';
    const surroundingTokens = tokens
      .filter(t => (t.contractAddress || t.address || '') !== centerAddress)
      .slice(0, 5);

    // Get token image URL with fallback
    const getTokenImage = (token) => {
      // Primary: logoUrl from backend
      if (token.logoUrl) return token.logoUrl;
      // Fallbacks for other field names
      if (token.image) return token.image;
      if (token.logo) return token.logo;
      // Try nested data structures
      if (token.dexscreenerData?.pairs?.[0]?.info?.imageUrl) {
        return token.dexscreenerData.pairs[0].info.imageUrl;
      }
      if (token.birdeyeData?.logo) {
        return token.birdeyeData.logo;
      }
      // Try to construct DexScreener URL from address as last resort
      if (token.contractAddress) {
        return `https://dd.dexscreener.com/ds-data/tokens/${token.contractAddress}.png`;
      }
      return null;
    };

    // Get token letter for display (fallback)
    const getTokenLetter = (token) => {
      return (token.symbol || token.name || '?').charAt(0).toUpperCase();
    };

    // Calculate position and size for each token on the radar
    // Using golden angle distribution for even positioning
    const goldenAngle = 137.5; // degrees
    const positions = surroundingTokens.map((token, index) => {
      const angle = (index * goldenAngle) % 360;
      // Distance from center: closer tokens have higher scores
      // We sort by score descending, so index 0 is closest
      const distancePercent = 35 + (index * 11); // 35%, 46%, 57%, 68%, 79%

      // Calculate size based on score ratio to center (minimum 50%, maximum 95%)
      const tokenScore = getTokenScore(token);
      const sizeRatio = Math.max(0.5, Math.min(0.95, tokenScore / centerScoreValue));

      return {
        token,
        angle,
        distancePercent,
        sizeRatio,
        rank: index + 1
      };
    });

    // Check if radar chart already exists - if so, do smart update
    let radarChart = container.querySelector('.radar-chart');
    const isUpdate = !!radarChart;

    if (!radarChart) {
      // Create radar chart HTML (initial render)
      radarChart = document.createElement('div');
      radarChart.className = 'radar-chart';

      // Build the radar HTML structure
      radarChart.innerHTML = `
        <!-- Radar Grid Circles -->
        <div class="radar-grid-circles">
          <div class="radar-circle c1"></div>
          <div class="radar-circle c2"></div>
          <div class="radar-circle c3"></div>
          <div class="radar-circle c4"></div>
          <div class="radar-circle c5"></div>
        </div>

        <!-- Radar Lines -->
        <div class="radar-grid-lines">
          <div class="radar-line"></div>
          <div class="radar-line"></div>
          <div class="radar-line"></div>
          <div class="radar-line"></div>
          <div class="radar-line"></div>
        </div>

        <!-- Scanning Animation -->
        <div class="radar-scanning">
          <div class="radar-scan-line"></div>
        </div>

        <!-- Pulse Rings -->
        <div class="radar-pulse"></div>
        <div class="radar-pulse"></div>
        <div class="radar-pulse"></div>

        <!-- Center Token Display -->
        <div class="radar-center">
          <div class="radar-center-coin"></div>
          <div class="radar-center-score"></div>
          <div class="radar-center-name"></div>
        </div>

        <!-- Token Positions Container -->
        <div class="radar-tokens-container"></div>

        <!-- Tooltip Container -->
        <div class="radar-tooltip" id="${containerId}-tooltip">
          <div class="radar-tooltip-header">
            <div class="radar-tooltip-logo" id="${containerId}-tooltip-logo">?</div>
            <div>
              <div class="radar-tooltip-name" id="${containerId}-tooltip-name">Token</div>
              <div class="radar-tooltip-score" id="${containerId}-tooltip-score">0.0</div>
            </div>
          </div>
          <div class="radar-tooltip-metric">
            <span class="radar-tooltip-metric-label">Market Cap</span>
            <span class="radar-tooltip-metric-value" id="${containerId}-tooltip-mc">$0</span>
          </div>
          <div class="radar-tooltip-metric">
            <span class="radar-tooltip-metric-label">Volume 24h</span>
            <span class="radar-tooltip-metric-value" id="${containerId}-tooltip-volume">$0</span>
          </div>
          <div class="radar-tooltip-metric">
            <span class="radar-tooltip-metric-label">Multiplier</span>
            <span class="radar-tooltip-metric-value" id="${containerId}-tooltip-multiplier">N/A</span>
          </div>
        </div>
      `;

      container.innerHTML = '';
      container.appendChild(radarChart);
    }

    // Update center token (always update this)
    const centerCoin = radarChart.querySelector('.radar-center-coin');
    const centerScoreEl = radarChart.querySelector('.radar-center-score');
    const centerName = radarChart.querySelector('.radar-center-name');

    const centerTokenImage = getTokenImage(centerToken);
    if (centerCoin) {
      const existingImg = centerCoin.querySelector('.radar-center-img');
      const existingSpan = centerCoin.querySelector('span');
      const hasImageChanged = !existingImg || (existingImg && existingImg.src !== centerTokenImage && centerTokenImage);

      if (hasImageChanged || !existingImg) {
        if (centerTokenImage) {
          centerCoin.innerHTML = `<img src="${centerTokenImage}" alt="${centerToken.symbol || 'Token'}" class="radar-center-img" onerror="this.style.display='none';this.nextElementSibling?.style.display='flex';"><span style="display:none">${getTokenLetter(centerToken)}</span>`;
        } else {
          centerCoin.textContent = getTokenLetter(centerToken);
        }
      }
    }
    if (centerScoreEl) {
      const score = getTokenScore(centerToken);
      if (centerToken.score !== undefined) {
        centerScoreEl.textContent = score.toFixed(1);
      } else if (centerToken.holderRank !== undefined) {
        centerScoreEl.textContent = `#${centerToken.holderRank}`;
      } else {
        centerScoreEl.textContent = 'N/A';
      }
    }
    if (centerName) centerName.textContent = centerToken.symbol || centerToken.name || 'UNKNOWN';

    // Add hover functionality to center coin
    if (centerCoin && !centerCoin.hasAttribute('data-has-tooltip')) {
      centerCoin.setAttribute('data-has-tooltip', 'true');
      centerCoin.style.cursor = 'pointer';

      // Store token data for tooltip
      centerCoin.setAttribute('data-name', centerToken.name || 'Unknown');
      centerCoin.setAttribute('data-symbol', centerToken.symbol || '?');
      centerCoin.setAttribute('data-score', getTokenScore(centerToken).toFixed(1));
      centerCoin.setAttribute('data-mc', centerToken.currentMc || 0);
      centerCoin.setAttribute('data-volume', centerToken.volume24h || 0);
      centerCoin.setAttribute('data-multiplier', centerToken.multiplier || centerToken.currentMultiplier || 'N/A');

      centerCoin.addEventListener('mouseenter', () => {
        const tooltip = document.getElementById(`${containerId}-tooltip`);
        if (!tooltip) return;

        const name = centerCoin.getAttribute('data-name');
        const symbol = centerCoin.getAttribute('data-symbol');
        const score = centerCoin.getAttribute('data-score');
        const mc = centerCoin.getAttribute('data-mc');
        const volume = centerCoin.getAttribute('data-volume');
        const multiplier = centerCoin.getAttribute('data-multiplier');

        // Get token image
        const tokenImg = centerCoin.querySelector('.radar-center-img');
        const imgUrl = tokenImg ? tokenImg.src : null;

        // Update tooltip content
        const logoEl = document.getElementById(`${containerId}-tooltip-logo`);
        const nameEl = document.getElementById(`${containerId}-tooltip-name`);
        const scoreEl = document.getElementById(`${containerId}-tooltip-score`);
        const mcEl = document.getElementById(`${containerId}-tooltip-mc`);
        const volumeEl = document.getElementById(`${containerId}-tooltip-volume`);
        const multiplierEl = document.getElementById(`${containerId}-tooltip-multiplier`);

        if (logoEl) {
          if (imgUrl) {
            logoEl.innerHTML = `<img src="${imgUrl}" alt="${symbol}" class="radar-tooltip-logo-img">`;
          } else {
            logoEl.textContent = symbol?.charAt(0).toUpperCase() || '?';
          }
        }
        if (nameEl) nameEl.textContent = symbol || name;
        if (scoreEl) scoreEl.textContent = score;
        if (mcEl) mcEl.textContent = this.formatCurrency(parseFloat(mc) || 0);
        if (volumeEl) volumeEl.textContent = this.formatCurrency(parseFloat(volume) || 0);
        if (multiplierEl) multiplierEl.textContent = multiplier || 'N/A';

        // Position tooltip
        const rect = centerCoin.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();

        tooltip.style.left = `${rect.left - containerRect.left + rect.width / 2}px`;
        tooltip.style.top = `${rect.top - containerRect.top - 10}px`;
        tooltip.style.transform = 'translate(-50%, -100%)';
        tooltip.classList.add('active');
      });

      centerCoin.addEventListener('mouseleave', () => {
        const tooltip = document.getElementById(`${containerId}-tooltip`);
        if (tooltip) {
          tooltip.classList.remove('active');
        }
      });

      // Click to copy
      centerCoin.addEventListener('click', () => {
        const address = centerToken.contractAddress || centerToken.address;
        if (address) {
          navigator.clipboard.writeText(address).then(() => {
            this.showRadarCopyFeedback();
          }).catch(err => {
            console.error('Failed to copy address:', err);
          });
        }
      });
    }

    // Update or create token elements
    let tokensContainer = radarChart.querySelector('.radar-tokens-container');
    if (!tokensContainer) {
      // Create container if it doesn't exist
      tokensContainer = document.createElement('div');
      tokensContainer.className = 'radar-tokens-container';
      radarChart.appendChild(tokensContainer);
    }

    // Get existing tokens by address
    const existingTokens = {};
    radarChart.querySelectorAll('.radar-token').forEach(el => {
      const addr = el.getAttribute('data-address');
      if (addr) existingTokens[addr] = el;
    });

    // Track which tokens are still in the top 5
    const currentAddresses = new Set();

    // Update or create token elements
    positions.forEach((pos, idx) => {
      const tokenAddress = pos.token.contractAddress || pos.token.address || '';
      const tokenImage = getTokenImage(pos.token);
      const tokenLetter = getTokenLetter(pos.token);
      const tokenScore = getTokenScore(pos.token);

      currentAddresses.add(tokenAddress);

      const angleRad = (pos.angle - 90) * (Math.PI / 180);
      const x = 50 + (pos.distancePercent / 2) * Math.cos(angleRad);
      const y = 50 + (pos.distancePercent / 2) * Math.sin(angleRad);

      // Calculate size based on score ratio (44px is base size, scaled by ratio)
      const baseSize = 44;
      const tokenSize = Math.round(baseSize * pos.sizeRatio);

      let tokenEl = existingTokens[tokenAddress];
      const isNew = !tokenEl;

      if (isNew) {
        // Create new token element
        tokenEl = document.createElement('div');
        tokenEl.className = `radar-token rank-${pos.rank}`;
        tokenEl.style.left = `${x}%`;
        tokenEl.style.top = `${y}%`;
        tokenEl.style.width = `${tokenSize}px`;
        tokenEl.style.height = `${tokenSize}px`;
        tokenEl.style.transform = 'translate(-50%, -50%)';
        tokenEl.style.setProperty('--float-delay', `${idx * 0.2}s`);

        // Set data attributes
        tokenEl.setAttribute('data-address', tokenAddress);
        tokenEl.setAttribute('data-name', pos.token.name || 'Unknown');
        tokenEl.setAttribute('data-symbol', pos.token.symbol || '?');
        tokenEl.setAttribute('data-score', tokenScore.toFixed(1));
        tokenEl.setAttribute('data-mc', pos.token.currentMc || 0);
        tokenEl.setAttribute('data-volume', pos.token.volume24h || 0);
        tokenEl.setAttribute('data-multiplier', pos.token.multiplier || pos.token.currentMultiplier || 'N/A');
        tokenEl.setAttribute('title', pos.token.symbol || pos.token.name);

        // Set content
        if (tokenImage) {
          tokenEl.innerHTML = `<img src="${tokenImage}" alt="${pos.token.symbol || 'Token'}" class="radar-token-img" onerror="this.style.display='none';this.nextElementSibling?.style.display='flex';"><span style="display:none">${tokenLetter}</span>`;
        } else {
          tokenEl.textContent = tokenLetter;
        }

        tokensContainer.appendChild(tokenEl);
      } else {
        // Update existing token element
        tokenEl.className = `radar-token rank-${pos.rank}`;
        tokenEl.style.left = `${x}%`;
        tokenEl.style.top = `${y}%`;
        tokenEl.style.width = `${tokenSize}px`;
        tokenEl.style.height = `${tokenSize}px`;
        tokenEl.setAttribute('data-name', pos.token.name || 'Unknown');
        tokenEl.setAttribute('data-symbol', pos.token.symbol || '?');
        tokenEl.setAttribute('title', pos.token.symbol || pos.token.name);

        // Update data attributes
        tokenEl.setAttribute('data-score', tokenScore.toFixed(1));
        tokenEl.setAttribute('data-mc', pos.token.currentMc || 0);
        tokenEl.setAttribute('data-volume', pos.token.volume24h || 0);
        tokenEl.setAttribute('data-multiplier', pos.token.multiplier || pos.token.currentMultiplier || 'N/A');

        // Update image if changed
        const existingImg = tokenEl.querySelector('.radar-token-img');
        if (tokenImage && existingImg && existingImg.src !== tokenImage) {
          existingImg.src = tokenImage;
        } else if (!tokenImage && existingImg) {
          // Image was removed, fall back to letter
          tokenEl.textContent = tokenLetter;
        }
      }

      // Track new tokens for listener setup
      if (isNew) {
        if (!this.newRadarTokens) this.newRadarTokens = [];
        this.newRadarTokens.push(tokenEl);
      }
    });

    // Remove tokens that are no longer in the top 5
    Object.entries(existingTokens).forEach(([addr, el]) => {
      if (!currentAddresses.has(addr)) {
        el.remove();
      }
    });

    // Only setup listeners for new tokens (prevents duplicate listeners and jitter)
    if (this.newRadarTokens && this.newRadarTokens.length > 0) {
      this.setupRadarTokenListeners(containerId, this.newRadarTokens);
      this.newRadarTokens = [];
    }
    } catch (error) {
      console.error(`renderRadarChart error for ${containerId}:`, error);
      container.innerHTML = `
        <div class="radar-empty-state">
          <div class="radar-empty-icon">⚠</div>
          <div class="radar-empty-text">Error: ${error.message}</div>
        </div>
      `;
    }
  }

  setupRadarTokenListeners(containerId, tokenElements = null) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const tooltip = document.getElementById(`${containerId}-tooltip`);

    // If no specific elements provided, get all radar tokens (fallback for initial render)
    const tokensToListen = tokenElements || Array.from(container.querySelectorAll('.radar-token'));

    // Token hover events - only for new/specified tokens
    tokensToListen.forEach(tokenEl => {
      tokenEl.addEventListener('mouseenter', (e) => {
        const name = tokenEl.getAttribute('data-name');
        const symbol = tokenEl.getAttribute('data-symbol');
        const score = tokenEl.getAttribute('data-score');
        const mc = tokenEl.getAttribute('data-mc');
        const volume = tokenEl.getAttribute('data-volume');
        const multiplier = tokenEl.getAttribute('data-multiplier');

        // Get token image from the element
        const tokenImg = tokenEl.querySelector('.radar-token-img');
        const imgUrl = tokenImg ? tokenImg.src : null;

        // Update tooltip content
        const logoEl = document.getElementById(`${containerId}-tooltip-logo`);
        const nameEl = document.getElementById(`${containerId}-tooltip-name`);
        const scoreEl = document.getElementById(`${containerId}-tooltip-score`);
        const mcEl = document.getElementById(`${containerId}-tooltip-mc`);
        const volumeEl = document.getElementById(`${containerId}-tooltip-volume`);
        const multiplierEl = document.getElementById(`${containerId}-tooltip-multiplier`);

        if (logoEl) {
          if (imgUrl) {
            logoEl.innerHTML = `<img src="${imgUrl}" alt="${symbol}" class="radar-tooltip-logo-img">`;
          } else {
            logoEl.textContent = symbol.charAt(0).toUpperCase();
          }
        }
        if (nameEl) nameEl.textContent = symbol || name;
        if (scoreEl) scoreEl.textContent = score;
        if (mcEl) mcEl.textContent = this.formatCurrency(parseFloat(mc) || 0);
        if (volumeEl) volumeEl.textContent = this.formatCurrency(parseFloat(volume) || 0);
        if (multiplierEl) multiplierEl.textContent = multiplier || 'N/A';

        // Position tooltip
        const rect = tokenEl.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();

        if (tooltip) {
          tooltip.style.left = `${rect.left - containerRect.left + rect.width / 2}px`;
          tooltip.style.top = `${rect.top - containerRect.top - 10}px`;
          tooltip.style.transform = 'translate(-50%, -100%)';
          tooltip.classList.add('active');
        }
      });

      tokenEl.addEventListener('mouseleave', () => {
        if (tooltip) {
          tooltip.classList.remove('active');
        }
      });

      // Click to copy contract address
      tokenEl.addEventListener('click', () => {
        const address = tokenEl.getAttribute('data-address');
        if (address) {
          navigator.clipboard.writeText(address).then(() => {
            this.showRadarCopyFeedback();
            tokenEl.classList.add('clicking');
            setTimeout(() => tokenEl.classList.remove('clicking'), 200);
          }).catch(err => {
            console.error('Failed to copy address:', err);
          });
        }
      });
    });
  }

  showRadarCopyFeedback() {
    let feedback = document.querySelector('.radar-copy-feedback');
    if (!feedback) {
      feedback = document.createElement('div');
      feedback.className = 'radar-copy-feedback';
      feedback.textContent = 'COPIED!';
      document.body.appendChild(feedback);
    }

    feedback.classList.add('show');
    setTimeout(() => {
      feedback.classList.remove('show');
    }, 1500);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new DexterApp();
  initializeSettingsToggle();
  initializeChannelModal();
});

// ============================================
// SETTINGS TOGGLE - Show/Hide Controls
// ============================================

function initializeSettingsToggle() {
  const settingsBtn = document.getElementById('settings-toggle-btn');
  const controls = document.getElementById('collapsible-controls');
  
  // Load saved state
  const savedState = localStorage.getItem('controlsVisible');
  const isVisible = savedState !== null ? savedState === 'true' : true;
  
  if (!isVisible) {
    controls.classList.add('hidden');
  } else {
    settingsBtn.classList.add('active');
  }
  
  settingsBtn.addEventListener('click', () => {
    controls.classList.toggle('hidden');
    settingsBtn.classList.toggle('active');
    
    const visible = !controls.classList.contains('hidden');
    localStorage.setItem('controlsVisible', visible.toString());
  });
}

// ============================================
// CHANNEL MANAGEMENT MODAL
// ============================================

function initializeChannelModal() {
  const manageBtn = document.getElementById('manage-channels-btn');
  const modal = document.getElementById('channel-modal');
  const closeBtn = document.getElementById('close-channel-modal');
  const cancelBtn = document.getElementById('cancel-channels-btn');
  const saveBtn = document.getElementById('save-channels-btn');
  const addBtn = document.getElementById('add-channel-btn');
  const channelsList = document.getElementById('channels-list');
  
  let channels = [];
  
  // Open modal
  manageBtn.addEventListener('click', async () => {
    await loadChannels();
    modal.style.display = 'flex';
  });
  
  // Close modal
  const closeModal = () => {
    modal.style.display = 'none';
  };
  
  closeBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);
  
  // Close on background click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
  
  // Add new channel
  addBtn.addEventListener('click', () => {
    channels.push({ url: '', enabled: true });
    renderChannels();
  });
  
  // Save channels
  saveBtn.addEventListener('click', async () => {
    try {
      const response = await fetch(API_BASE + '/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channels })
      });
      
      if (response.ok) {
        console.log('✅ Channels saved successfully');
        closeModal();
      } else {
        console.error('❌ Failed to save channels');
        alert('Failed to save channels. Please try again.');
      }
    } catch (err) {
      console.error('❌ Error saving channels:', err);
      alert('Error saving channels: ' + err.message);
    }
  });
  
  // Load channels from backend
  async function loadChannels() {
    try {
      const response = await fetch(API_BASE + '/channels');
      if (response.ok) {
        const data = await response.json();
        channels = data.channels || [];
        
        // Ensure at least one empty channel
        if (channels.length === 0) {
          channels.push({ url: '', enabled: true });
        }
        
        renderChannels();
      }
    } catch (err) {
      console.error('Failed to load channels:', err);
      channels = [{ url: '', enabled: true }];
      renderChannels();
    }
  }
  
  // Render channels list
  function renderChannels() {
    channelsList.innerHTML = '';
    
    channels.forEach((channel, index) => {
      const item = document.createElement('div');
      item.className = 'channel-item';
      
      item.innerHTML = `
        <input type="checkbox" class="channel-checkbox" ${channel.enabled ? 'checked' : ''} data-index="${index}">
        <input type="text" class="channel-url-input" placeholder="https://web.telegram.org/a/#-1003318418308" value="${channel.url || ''}" data-index="${index}">
        <button class="remove-channel-btn" data-index="${index}">−</button>
      `;
      
      channelsList.appendChild(item);
    });
    
    // Add event listeners
    channelsList.querySelectorAll('.channel-checkbox').forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        const index = parseInt(e.target.dataset.index);
        channels[index].enabled = e.target.checked;
      });
    });
    
    channelsList.querySelectorAll('.channel-url-input').forEach(input => {
      input.addEventListener('input', (e) => {
        const index = parseInt(e.target.dataset.index);
        channels[index].url = e.target.value.trim();
      });
    });
    
    channelsList.querySelectorAll('.remove-channel-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = parseInt(e.target.dataset.index);
        channels.splice(index, 1);
        
        // Ensure at least one channel remains
        if (channels.length === 0) {
          channels.push({ url: '', enabled: true });
        }
        
        renderChannels();
      });
    });
  }
}
