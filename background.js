// Tab Decay Background Service Worker

const DECAY_THRESHOLDS = {
  HOURGLASS: 1 * 60 * 60 * 1000,      // 1 hour
  SKULL: 4 * 60 * 60 * 1000,          // 4 hours
  MOAI: 8 * 60 * 60 * 1000            // 8 hours
};

// // test
// const DECAY_THRESHOLDS = {
//   HOURGLASS: 1 * 60 * 1000,      // 1 min
//   SKULL: 3 * 60 * 1000,          // 3 min
//   MOAI: 6 * 60 * 1000            // 6 min
// };


const EMOJIS = {
  HOURGLASS: '⏳',
  SKULL: '💀',
  MOAI: '🗿'
};

const ALARM_NAME = 'tab-decay-update';
const ALARM_PERIOD_MINUTES = 1;

// Sites with frequent title updates - skip emoji to avoid flicker
const SKIP_DOMAINS = [
  'mail.google.com',      // Gmail
  'inbox.google.com',     // Inbox
  'slack.com',            // Slack workspaces
  'discord.com',          // Discord
  'web.whatsapp.com',     // WhatsApp Web
  'twitter.com',          // Twitter/X
  'x.com'                 // Twitter/X
];

// Learning thresholds for dynamic site detection
const TITLE_CHANGE_THRESHOLD = 5;        // Changes
const TITLE_CHANGE_WINDOW = 5 * 60 * 1000;  // Within 5 minutes

// Store original titles and last focused times
let tabMetadata = {};
let isEnabled = true;
let initPromise = null;

async function ensureInitialized() {
  if (!initPromise) {
    initPromise = (async () => {
      const data = await chrome.storage.local.get(['tabMetadata', 'isEnabled']);
      tabMetadata = data.tabMetadata || {};
      isEnabled = data.isEnabled !== undefined ? data.isEnabled : true;

      // FIX ISSUE 2: Prune stale metadata (tabs that no longer exist after crash/restart)
      const currentTabs = await chrome.tabs.query({});
      const currentTabIds = new Set(currentTabs.map(t => t.id));
      const staleIds = Object.keys(tabMetadata).filter(id => !currentTabIds.has(parseInt(id)));

      if (staleIds.length > 0) {
        staleIds.forEach(id => delete tabMetadata[id]);
        await chrome.storage.local.set({ tabMetadata });
      }

      await seedAllTabs();
    })();
  }

  return initPromise;
}

// Check if a URL should skip emoji (known dynamic sites)
function shouldSkipDomain(url) {
  if (!url) return false;
  try {
    const urlObj = new URL(url);
    return SKIP_DOMAINS.some(domain => urlObj.hostname.includes(domain));
  } catch {
    return false;
  }
}

// Check if tab should skip emoji (patterns + learning)
function shouldSkipTab(tabId) {
  const metadata = tabMetadata[tabId];
  if (!metadata) return false;

  // Check URL patterns
  if (shouldSkipDomain(metadata.url)) return true;

  // Check learned dynamic behavior
  if (metadata.isDynamic) return true;

  return false;
}

function seedTabMetadata(tab) {
  if (tabMetadata[tab.id]) return false;

  tabMetadata[tab.id] = {
    originalTitle: tab.title,
    lastFocusedTime: tab.lastAccessed || Date.now(),
    url: tab.url,
    titleChangeCount: 0,
    titleChangeWindow: Date.now(),
    isDynamic: false
  };

  return true;
}

async function seedAllTabs() {
  const tabs = await chrome.tabs.query({});
  let changed = false;

  tabs.forEach(tab => {
    if (seedTabMetadata(tab)) {
      changed = true;
    }
  });

  if (changed) {
    await chrome.storage.local.set({ tabMetadata });
  }
}

function scheduleAlarm() {
  chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: ALARM_PERIOD_MINUTES,
    periodInMinutes: ALARM_PERIOD_MINUTES
  });
}

// Initialize on install
chrome.runtime.onInstalled.addListener(async () => {
  await ensureInitialized();
  scheduleAlarm();
  await chrome.storage.local.set({ tabMetadata, isEnabled });
});

// Ensure alarm and state are ready on browser startup
chrome.runtime.onStartup.addListener(async () => {
  await ensureInitialized();
  scheduleAlarm();
});

// Track when tabs are focused
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  await ensureInitialized();
  const tab = await chrome.tabs.get(activeInfo.tabId);

  if (!tabMetadata[tab.id]) {
    seedTabMetadata(tab);
  }
  tabMetadata[tab.id].lastFocusedTime = Date.now();

  await chrome.storage.local.set({ tabMetadata });

  // Restore original title when focused
  if (isEnabled) {
    await updateTabTitle(tab.id);
  }
});

// Track newly created tabs (including background ones)
chrome.tabs.onCreated.addListener(async (tab) => {
  await ensureInitialized();
  const changed = seedTabMetadata(tab);

  if (changed) {
    await chrome.storage.local.set({ tabMetadata });
  }
});

// Track tab updates (like title changes)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  await ensureInitialized();
  if (changeInfo.title) {
    // Only update original title if we don't have metadata yet, or if the title doesn't start with our emojis
    if (!tabMetadata[tabId]) {
      tabMetadata[tabId] = {
        originalTitle: changeInfo.title,
        lastFocusedTime: Date.now(),
        url: tab.url,
        titleChangeCount: 0,
        titleChangeWindow: Date.now(),
        isDynamic: false
      };
    } else {
      // Check if this is a genuine title change (not our emoji prefix)
      const hasEmoji = Object.values(EMOJIS).some(emoji => changeInfo.title.startsWith(emoji));
      if (!hasEmoji) {
        // Skip if title matches what we already stored (just emoji being removed by toggle)
        if (changeInfo.title === tabMetadata[tabId].originalTitle) {
          return;
        }

        tabMetadata[tabId].originalTitle = changeInfo.title;

        // LEARNING: Track title change frequency to detect dynamic sites
        const now = Date.now();
        const metadata = tabMetadata[tabId];

        // Ensure metadata has tracking fields (for tabs created before this update)
        if (metadata.titleChangeCount === undefined) {
          metadata.titleChangeCount = 0;
          metadata.titleChangeWindow = now;
          metadata.isDynamic = false;
        }

        // Reset window if outside time range
        if (now - metadata.titleChangeWindow > TITLE_CHANGE_WINDOW) {
          metadata.titleChangeCount = 1;
          metadata.titleChangeWindow = now;
        } else {
          metadata.titleChangeCount++;
        }

        // Mark as dynamic if threshold exceeded
        if (metadata.titleChangeCount > TITLE_CHANGE_THRESHOLD && !metadata.isDynamic) {
          metadata.isDynamic = true;
          console.log(`[Tab Decay] Detected dynamic site: ${tab.url} (${metadata.titleChangeCount} title changes)`);
        }
      }
    }

    await chrome.storage.local.set({ tabMetadata });
  }
});

// Clean up removed tabs
chrome.tabs.onRemoved.addListener(async (tabId) => {
  await ensureInitialized();
  delete tabMetadata[tabId];
  await chrome.storage.local.set({ tabMetadata });
});

// Get decay emoji based on time elapsed
function getDecayEmoji(lastFocusedTime) {
  const elapsed = Date.now() - lastFocusedTime;

  if (elapsed >= DECAY_THRESHOLDS.MOAI) return EMOJIS.MOAI;
  if (elapsed >= DECAY_THRESHOLDS.SKULL) return EMOJIS.SKULL;
  if (elapsed >= DECAY_THRESHOLDS.HOURGLASS) return EMOJIS.HOURGLASS;

  return null;
}

// Update a tab's title with decay emoji
async function updateTabTitle(tabId, activeTabId = null) {
  if (!isEnabled || !tabMetadata[tabId]) return;

  // FIX ISSUE 1: Don't add decay emoji to the currently active tab
  if (activeTabId && tabId === activeTabId) {
    // Refresh the active tab's timestamp so it doesn't decay
    tabMetadata[tabId].lastFocusedTime = Date.now();
    return;
  }

  // Skip dynamic sites to avoid flicker (patterns + learning)
  if (shouldSkipTab(tabId)) {
    return;
  }

  const metadata = tabMetadata[tabId];
  const emoji = getDecayEmoji(metadata.lastFocusedTime);

  try {
    const tab = await chrome.tabs.get(tabId);
    const currentTitle = tab.title;

    if (emoji) {
      // Add emoji prefix if not already present
      if (!currentTitle.startsWith(emoji)) {
        // Remove any existing emoji first
        let cleanTitle = metadata.originalTitle;
        Object.values(EMOJIS).forEach(e => {
          cleanTitle = cleanTitle.replace(new RegExp(`^${e}\\s*`), '');
        });

        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: (newTitle) => { document.title = newTitle; },
          args: [`${emoji} ${cleanTitle}`]
        });
      }
    } else {
      // Remove emoji if no longer needed
      const hasEmoji = Object.values(EMOJIS).some(e => currentTitle.startsWith(e));
      if (hasEmoji) {
        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: (newTitle) => { document.title = newTitle; },
          args: [metadata.originalTitle]
        });
      }
    }
  } catch (error) {
    // Tab might not support script injection (chrome://, etc.)
    // Silently ignore
  }
}

// Periodically update all tab titles
async function updateAllTabs() {
  if (!isEnabled) return;

  const tabs = await chrome.tabs.query({});
  // FIX ISSUE 1: Get the currently active tab to skip it from decay
  const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const activeTabId = activeTabs.length > 0 ? activeTabs[0].id : null;

  let changed = false;

  for (const tab of tabs) {
    if (seedTabMetadata(tab)) {
      changed = true;
    }

    await updateTabTitle(tab.id, activeTabId);
  }

  if (changed) {
    await chrome.storage.local.set({ tabMetadata });
  }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  await ensureInitialized();
  await updateAllTabs();
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    await ensureInitialized();

    if (message.action === 'getStats') {
      await seedAllTabs();
      const tabs = await chrome.tabs.query({});
      const stats = {
        total: tabs.length,
        hourglass: 0,
        skull: 0,
        moai: 0,
        isEnabled: isEnabled,
        learnedSites: []
      };

      tabs.forEach(tab => {
        if (tabMetadata[tab.id] && !shouldSkipTab(tab.id)) {
          const emoji = getDecayEmoji(tabMetadata[tab.id].lastFocusedTime);
          if (emoji === EMOJIS.HOURGLASS) stats.hourglass++;
          else if (emoji === EMOJIS.SKULL) stats.skull++;
          else if (emoji === EMOJIS.MOAI) stats.moai++;
        }
      });

      // Collect learned dynamic sites
      Object.values(tabMetadata).forEach(metadata => {
        if (metadata.isDynamic && !stats.learnedSites.includes(metadata.url)) {
          stats.learnedSites.push(metadata.url);
        }
      });

      sendResponse(stats);
      return;
    }

    if (message.action === 'toggleEnabled') {
      isEnabled = !isEnabled;
      await chrome.storage.local.set({ isEnabled });

      if (!isEnabled) {
        // Restore all original titles
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
          if (tabMetadata[tab.id]) {
            try {
              await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: (newTitle) => { document.title = newTitle; },
                args: [tabMetadata[tab.id].originalTitle]
              });
            } catch (error) {
              // Ignore tabs that don't support scripting
            }
          }
        }
      } else {
        // Re-apply emoji prefixes
        await updateAllTabs();
      }

      sendResponse({ isEnabled });
      return;
    }

    if (message.action === 'purgeStale') {
      // Close tabs with hourglass emoji (1+ hours)
      const tabs = await chrome.tabs.query({});
      // FIX ISSUE 1: Get active tab to avoid closing it
      const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const activeTabId = activeTabs.length > 0 ? activeTabs[0].id : null;

      const tabsToPurge = [];

      tabs.forEach(tab => {
        if (tabMetadata[tab.id] && tab.id !== activeTabId && !shouldSkipTab(tab.id)) {
          const emoji = getDecayEmoji(tabMetadata[tab.id].lastFocusedTime);
          if (emoji === EMOJIS.HOURGLASS) {
            tabsToPurge.push(tab.id);
          }
        }
      });

      if (tabsToPurge.length === 0) {
        sendResponse({ closed: 0 });
        return;
      }

      await chrome.tabs.remove(tabsToPurge);
      sendResponse({ closed: tabsToPurge.length });
      return;
    }

    if (message.action === 'nukeRot') {
      // Close tabs with skull and moai emoji (4+ hours)
      const tabs = await chrome.tabs.query({});
      // FIX ISSUE 1: Get active tab to avoid closing it
      const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const activeTabId = activeTabs.length > 0 ? activeTabs[0].id : null;

      const tabsToNuke = [];

      tabs.forEach(tab => {
        if (tabMetadata[tab.id] && tab.id !== activeTabId && !shouldSkipTab(tab.id)) {
          const emoji = getDecayEmoji(tabMetadata[tab.id].lastFocusedTime);
          if (emoji === EMOJIS.SKULL || emoji === EMOJIS.MOAI) {
            tabsToNuke.push(tab.id);
          }
        }
      });

      if (tabsToNuke.length === 0) {
        sendResponse({ closed: 0 });
        return;
      }

      await chrome.tabs.remove(tabsToNuke);
      sendResponse({ closed: tabsToNuke.length });
    }
  })().catch(() => {
    // Swallow errors to avoid leaving the port hanging
    try {
      sendResponse({ closed: 0, error: true });
    } catch (e) {
      // ignore
    }
  });

  return true; // Keep message channel open for async response
});

// When the service worker spins up, ensure state is hydrated and titles are updated
ensureInitialized().then(() => updateAllTabs());

// Make sure the repeating alarm exists (it persists across worker restarts)
chrome.alarms.get(ALARM_NAME, (alarm) => {
  if (!alarm) {
    scheduleAlarm();
  }
});
