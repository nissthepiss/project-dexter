const API_BASE = 'http://localhost:3001/api';

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

class DexterApp {
  constructor() {
    this.tokenContainer = document.getElementById('token-list');
    this.mvpContainer = document.getElementById('mvp-content');
    this.tierValues = { tier1: 1.1, tier2: 1.2, tier3: 1.3 };
    this.alertedTokens = new Set();
    this.tier3AlertedTokens = new Set();
    this.isFirstFetch = true;
    this.tier1AlertSound = new Audio('../../assets/alert.mp3');

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
    this.initializeDexScreener();
    this.initializeBackendViewMode();
    this.startPolling();
  }

  playTier1Alert() {
    if (this.alertVolume === 0) return;
    this.tier1AlertSound.currentTime = 0;
    this.tier1AlertSound.play().catch(err => {
      console.warn('Could not play alert sound:', err);
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
    if (!publicCheckbox) return;
    
    // Disable public channels checkbox when telegram messaging is off
    if (!this.telegramAutoAlert) {
      publicCheckbox.disabled = true;
      publicCheckbox.checked = false;
      this.publicChannelsEnabled = false;
      localStorage.setItem('publicChannelsEnabled', 'false');
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
    // Mode button listeners (DEGEN / HOLDER) - Now using radio buttons
    document.querySelectorAll('input[name="mode"]').forEach(radio => {
      radio.addEventListener('change', async (e) => {
        const newMode = e.target.value;
        if (newMode === currentMode) return;

        currentMode = newMode;
        lastRenderedData = null;
        lastRenderedMVP = null;

        // Toggle view tabs based on mode
        const holderCurrentTab = document.getElementById('holder-current-tab');

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

        try {
          await fetch(`${API_BASE}/mode`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: currentMode })
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

    // Telegram Tokens button
    const telegramTokensBtn = document.getElementById('telegram-tokens-btn');
    if (telegramTokensBtn) {
      telegramTokensBtn.addEventListener('click', () => this.openTelegramTokensWindow());
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

  async startPolling() {
    await this.fetchTokens();
    setInterval(() => {
      this.fetchTokens();
    }, 1000);

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
    const clockEl = document.getElementById('system-clock');
    if (clockEl) {
      const now = new Date();
      const hours = now.getHours();
      const minutes = now.getMinutes().toString().padStart(2, '0');
      const ampm = hours >= 12 ? 'PM' : 'AM';
      const displayHours = hours % 12 || 12;
      clockEl.textContent = `${displayHours}:${minutes} ${ampm}`;
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
          for (const token of newTokens) {
            const multiplier = parseFloat(token.multiplier?.replace('x', '') || 0);
            if (multiplier >= this.tierValues.tier1 && !this.alertedTokens.has(token.contractAddress)) {
              this.alertedTokens.add(token.contractAddress);
              if (!this.isFirstFetch) {
                this.playTier1Alert();
                console.log(`Tier 1 alert: ${token.name} hit ${token.multiplier}`);
                break;
              }
            }
          }
        }

        if (this.isFirstFetch) {
          this.isFirstFetch = false;
          console.log('Initial tokens loaded, alerts enabled for new tier crossings');
        }

        currentTopTokens = newTokens;
        currentTierInfo = data.tierInfo || currentTierInfo;
        this.renderTokens();
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
        : `<span>${token.name.charAt(0).toUpperCase()}</span>`;

      previousTokenData[token.contractAddress] = {
        currentMc: token.currentMc,
        volume24h: token.volume24h,
        peakMultiplier: token.peakMultiplier
      };

      return `
        <div class="token-row ${rankClass}" data-address="${token.contractAddress}" title="Click to copy address">
          <div class="token-rank">${token.rank}</div>
          <div class="token-main">
            <div class="token-icon">${iconHtml}</div>
            <div class="token-info">
              <div class="token-name">${token.name}</div>
              <div class="token-address">${token.contractAddress}</div>
            </div>
          </div>
          <div class="token-cell spotted">${spottedMc}</div>
          <div class="token-cell current">${currentMc}${mcArrows}</div>
          <div class="token-cell volume">${volume}${volArrows}</div>
          <div class="token-cell net ${netClass}">${netDisplay}</div>
          <div class="token-cell time">${timeAgo}</div>
          <div class="token-cell peak">${multiplier}</div>
          <div class="token-actions">
            <button class="token-action-btn blacklist-btn" data-address="${token.contractAddress}" data-name="${token.name}" title="Blacklist token">⍰</button>
          </div>
          <div class="token-actions">
            <button class="token-action-btn telegram-btn" data-address="${token.contractAddress}" title="Send to Telegram">⇡</button>
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

  renderMVP() {
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
      this.fullRenderMVP(mvp);
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

    // Get components
    const components = mvp.components || {};
    const buyPressure = components.buyPressure || { raw: 0, weighted: 0 };
    const netBuyVolume = components.netBuyVolume || { raw: 0, weighted: 0 };
    const txnsVelocity = components.txnsVelocity || { raw: 0, weighted: 0 };
    const priceMomentum = components.priceMomentum || { raw: 0, weighted: 0 };
    const sseMomentum = components.sseMomentum || { raw: 0, weighted: 0 };

    // Update breakdown items
    const breakdownItems = this.mvpContainer.querySelectorAll('.mvp-breakdown-item');

    // Buy Pressure (item 0)
    if (breakdownItems[0]) {
      const valEl = breakdownItems[0].querySelector('.mvp-breakdown-values span:first-child');
      const ptsEl = breakdownItems[0].querySelector('.mvp-breakdown-contribution');
      const barEl = breakdownItems[0].querySelector('.mvp-breakdown-fill');

      const newBuyPressure = `${(buyPressure.raw * 100).toFixed(1)}%`;
      const buyPressureColor = this.getBuyPressureColor(buyPressure.raw);

      if (valEl && valEl.textContent !== newBuyPressure) {
        valEl.textContent = newBuyPressure;
        valEl.style.color = buyPressureColor;
      }
      updateEl(ptsEl, `→ ${buyPressure.weighted.toFixed(1)} pts`);
      if (barEl) {
        barEl.style.width = `${buyPressure.raw * 100}%`;
        barEl.style.background = buyPressureColor;
      }
    }

    // Net Buy Volume (item 1)
    if (breakdownItems[1]) {
      const valEl = breakdownItems[1].querySelector('.mvp-breakdown-values span:first-child');
      const ptsEl = breakdownItems[1].querySelector('.mvp-breakdown-contribution');

      const newNetVol = this.formatUSD(netBuyVolume.raw);
      const netVolColor = netBuyVolume.raw >= 0 ? '#4ade80' : '#f87171';

      if (valEl && valEl.textContent !== newNetVol) {
        valEl.textContent = newNetVol;
        valEl.style.color = netVolColor;
      }
      updateEl(ptsEl, `→ ${netBuyVolume.weighted.toFixed(1)} pts`);
    }

    // Transaction Velocity (item 2)
    if (breakdownItems[2]) {
      const valEl = breakdownItems[2].querySelector('.mvp-breakdown-values span:first-child');
      const ptsEl = breakdownItems[2].querySelector('.mvp-breakdown-contribution');

      const newTxns = `${txnsVelocity.raw} txns/5m`;

      updateEl(valEl, newTxns);
      updateEl(ptsEl, `→ ${txnsVelocity.weighted.toFixed(1)} pts`);
    }

    // Price Momentum (item 3)
    if (breakdownItems[3]) {
      const valEl = breakdownItems[3].querySelector('.mvp-breakdown-values span:first-child');
      const ptsEl = breakdownItems[3].querySelector('.mvp-breakdown-contribution');

      const raw = priceMomentum.raw;
      const newPriceMom = `${raw >= 0 ? '+' : ''}${raw.toFixed(1)}%`;
      const priceColor = raw >= 0 ? '#4ade80' : '#f87171';

      if (valEl && valEl.textContent !== newPriceMom) {
        valEl.textContent = newPriceMom;
        valEl.style.color = priceColor;
      }
      updateEl(ptsEl, `→ ${priceMomentum.weighted.toFixed(1)} pts`);
    }

    // SSE Momentum (item 4)
    if (breakdownItems[4]) {
      const valEl = breakdownItems[4].querySelector('.mvp-breakdown-values span:first-child');
      const ptsEl = breakdownItems[4].querySelector('.mvp-breakdown-contribution');

      const raw = sseMomentum.raw;
      const newSSE = `${raw >= 0 ? '+' : ''}${(raw * 100).toFixed(1)}%`;
      const sseColor = raw >= 0 ? '#4ade80' : '#f87171';

      if (valEl && valEl.textContent !== newSSE) {
        valEl.textContent = newSSE;
        valEl.style.color = sseColor;
      }
      updateEl(ptsEl, `→ ${sseMomentum.weighted.toFixed(1)} pts`);
    }

    // Update metrics freshness indicator
    const metricsStatusEl = this.mvpContainer.querySelector('.mvp-metrics-status');
    if (metricsStatusEl && mvp.metricsFresh !== undefined) {
      const statusHtml = mvp.metricsFresh
        ? '<span style="color: #4ade80">✓ Fresh</span>'
        : '<span style="color: #f87171">⚠ Stale</span>';
      if (metricsStatusEl.innerHTML !== `Metrics: ${statusHtml}`) {
        metricsStatusEl.innerHTML = `Metrics: ${statusHtml}`;
      }
    }

    // Update stats
    const statValues = this.mvpContainer.querySelectorAll('.mvp-stat-value');
    updateEl(statValues[0], this.formatCurrency(mvp.currentMc));
    updateEl(statValues[1], this.formatCurrency(mvp.volume24h));
    updateEl(statValues[2], this.formatCurrency(mvp.spottedMc || 0));
    updateEl(statValues[3], mvp.multiplier || 'N/A');
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

  fullRenderMVP(mvp) {
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

    this.mvpContainer.innerHTML = `
      <div class="mvp-token">
        <div class="mvp-header">
          <div class="mvp-logo">${logoHtml}</div>
          <div class="mvp-info">
            <div class="mvp-name">${mvp.name}</div>
            <div class="mvp-address">${mvp.contractAddress}</div>
          </div>
        </div>

        <div class="mvp-section">
          <div class="mvp-section-title">MOMENTUM SCORE</div>
          <div class="mvp-score">${mvp.score.toFixed(1)}</div>
        </div>

        <div class="mvp-section">
          <div class="mvp-section-title">SCORE BREAKDOWN</div>
          <div class="mvp-breakdown">
            <!-- Buy Pressure -->
            <div class="mvp-breakdown-item">
              <div class="mvp-breakdown-label">
                <span class="mvp-breakdown-icon">📈</span>
                Buy Pressure
              </div>
              <div class="mvp-breakdown-values">
                <span style="color: ${buyPressureColor}">${buyPressurePercent}%</span>
                <span class="mvp-breakdown-contribution" style="color: #60a5fa">
                  → ${buyPressure.weighted.toFixed(1)} pts
                </span>
              </div>
              <div class="mvp-breakdown-bar">
                <div class="mvp-breakdown-fill" style="width: ${buyPressurePercent}%; background: ${buyPressureColor}"></div>
              </div>
            </div>

            <!-- Net Buy Volume -->
            <div class="mvp-breakdown-item">
              <div class="mvp-breakdown-label">
                <span class="mvp-breakdown-icon">💰</span>
                Net Buy Volume
              </div>
              <div class="mvp-breakdown-values">
                <span style="color: ${netBuyVolumeColor}">${this.formatUSD(netBuyVolume.raw)}</span>
                <span class="mvp-breakdown-contribution" style="color: #a78bfa">
                  → ${netBuyVolume.weighted.toFixed(1)} pts
                </span>
              </div>
            </div>

            <!-- Transaction Velocity -->
            <div class="mvp-breakdown-item">
              <div class="mvp-breakdown-label">
                <span class="mvp-breakdown-icon">⚡</span>
                Txns Velocity
              </div>
              <div class="mvp-breakdown-values">
                <span>${txnsVelocity.raw} txns/5m</span>
                <span class="mvp-breakdown-contribution" style="color: #fbbf24">
                  → ${txnsVelocity.weighted.toFixed(1)} pts
                </span>
              </div>
            </div>

            <!-- Price Momentum -->
            <div class="mvp-breakdown-item">
              <div class="mvp-breakdown-label">
                <span class="mvp-breakdown-icon">🚀</span>
                Price Momentum
              </div>
              <div class="mvp-breakdown-values">
                <span style="color: ${priceMomentumColor}">
                  ${priceMomentum.raw >= 0 ? '+' : ''}${priceMomentum.raw.toFixed(1)}%
                </span>
                <span class="mvp-breakdown-contribution" style="color: #34d399">
                  → ${priceMomentum.weighted.toFixed(1)} pts
                </span>
              </div>
            </div>

            <!-- SSE Momentum -->
            <div class="mvp-breakdown-item">
              <div class="mvp-breakdown-label">
                <span class="mvp-breakdown-icon">📡</span>
                SSE Momentum
              </div>
              <div class="mvp-breakdown-values">
                <span style="color: ${sseMomentumColor}">
                  ${sseMomentum.raw >= 0 ? '+' : ''}${(sseMomentum.raw * 100).toFixed(1)}%
                </span>
                <span class="mvp-breakdown-contribution" style="color: #f472b6">
                  → ${sseMomentum.weighted.toFixed(1)} pts
                </span>
              </div>
            </div>
          </div>
          <div class="mvp-metrics-status">
            Metrics: ${metricsFresh ? '<span style="color: #4ade80">✓ Fresh</span>' : '<span style="color: #f87171">⚠ Stale</span>'}
          </div>
        </div>

        <div class="mvp-section">
          <div class="mvp-section-title">STATS</div>
          <div class="mvp-stats">
            <div class="mvp-stat">
              <div class="mvp-stat-label">Current MC</div>
              <div class="mvp-stat-value">${this.formatCurrency(mvp.currentMc)}</div>
            </div>
            <div class="mvp-stat">
              <div class="mvp-stat-label">Volume 24h</div>
              <div class="mvp-stat-value">${this.formatCurrency(mvp.volume24h)}</div>
            </div>
            <div class="mvp-stat">
              <div class="mvp-stat-label">Spotted MC</div>
              <div class="mvp-stat-value">${this.formatCurrency(mvp.spottedMc || 0)}</div>
            </div>
            <div class="mvp-stat">
              <div class="mvp-stat-label">Peak</div>
              <div class="mvp-stat-value">${mvp.multiplier || 'N/A'}</div>
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

    const currentGain = mvp.spottedMc > 0 ? ((mvp.currentMc - mvp.spottedMc) / mvp.spottedMc * 100) : 0;
    const gainClass = currentGain >= 0 ? 'positive' : 'negative';
    const gainSign = currentGain >= 0 ? '+' : '';

    this.mvpContainer.innerHTML = `
      <div class="mvp-token">
        <div class="mvp-header">
          <div class="mvp-logo">${logoHtml}</div>
          <div class="mvp-info">
            <div class="mvp-name">${mvp.name}</div>
            <div class="mvp-address">${mvp.contractAddress}</div>
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
    const cards = document.querySelectorAll('.token-row[data-address]');
    cards.forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.blacklist-btn')) return;
        if (e.target.closest('.telegram-btn')) return;
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

  showError(message) {
    this.tokenContainer.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text" style="color: #f87171;">${message}</div></div>`;
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

    if (!confirm('Are you sure you want to purge ALL tracked tokens? This will delete everything and start fresh.')) {
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

    newWindow.addEventListener('beforeunload', () => {
      clearInterval(pollInterval);
      clearInterval(timeInterval);
    });
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
