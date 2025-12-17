// Tab Decay Background Service Worker

const DECAY_THRESHOLDS = {
  HOURGLASS: 1 * 60 * 60 * 1000,      // 1 hour
  SKULL: 4 * 60 * 60 * 1000,          // 4 hours
  TRASH: 8 * 60 * 60 * 1000,          // 8 hours
  MOAI: 2 * 24 * 60 * 60 * 1000       // 2 days
};

const EMOJIS = {
  HOURGLASS: '⏳',
  SKULL: '💀',
  TRASH: '🗑️',
  MOAI: '🗿'
};

const ALARM_NAME = 'tab-decay-update';
const ALARM_PERIOD_MINUTES = 1;

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

function seedTabMetadata(tab) {
  if (tabMetadata[tab.id]) return false;

  tabMetadata[tab.id] = {
    originalTitle: tab.title,
    lastFocusedTime: tab.lastAccessed || Date.now(),
    url: tab.url
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
        url: tab.url
      };
    } else {
      // Check if this is a genuine title change (not our emoji prefix)
      const hasEmoji = Object.values(EMOJIS).some(emoji => changeInfo.title.startsWith(emoji));
      if (!hasEmoji) {
        tabMetadata[tabId].originalTitle = changeInfo.title;
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
  if (elapsed >= DECAY_THRESHOLDS.TRASH) return EMOJIS.TRASH;
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
        trash: 0,
        moai: 0,
        isEnabled: isEnabled
      };

      tabs.forEach(tab => {
        if (tabMetadata[tab.id]) {
          const emoji = getDecayEmoji(tabMetadata[tab.id].lastFocusedTime);
          if (emoji === EMOJIS.HOURGLASS) stats.hourglass++;
          else if (emoji === EMOJIS.SKULL) stats.skull++;
          else if (emoji === EMOJIS.TRASH) stats.trash++;
          else if (emoji === EMOJIS.MOAI) stats.moai++;
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
        if (tabMetadata[tab.id] && tab.id !== activeTabId) {
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
      // Close tabs with skull, trash, and moai emoji (4+ hours)
      const tabs = await chrome.tabs.query({});
      // FIX ISSUE 1: Get active tab to avoid closing it
      const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const activeTabId = activeTabs.length > 0 ? activeTabs[0].id : null;

      const tabsToNuke = [];

      tabs.forEach(tab => {
        if (tabMetadata[tab.id] && tab.id !== activeTabId) {
          const emoji = getDecayEmoji(tabMetadata[tab.id].lastFocusedTime);
          if (emoji === EMOJIS.SKULL || emoji === EMOJIS.TRASH || emoji === EMOJIS.MOAI) {
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
