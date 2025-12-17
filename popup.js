// Tab Decay Popup Logic

// DOM Elements
const toggleEnabled = document.getElementById('toggle-enabled');
const purgeStaleBtn = document.getElementById('purge-stale');
const nukeRotBtn = document.getElementById('nuke-rot');
const brutalTooltip = document.getElementById('brutal-tooltip');

const DEFAULT_PURGE_LABEL = 'PURGE STALE ⏳';
const DEFAULT_NUKE_LABEL = 'NUKE THE ROT 💀🗿';

const totalTabsEl = document.getElementById('total-tabs');
const hourglassCountEl = document.getElementById('hourglass-count');
const skullCountEl = document.getElementById('skull-count');
const moaiCountEl = document.getElementById('moai-count');

// Load and display stats
async function loadStats() {
  chrome.runtime.sendMessage({ action: 'getStats' }, (stats) => {
    if (stats) {
      totalTabsEl.textContent = stats.total;
      hourglassCountEl.textContent = stats.hourglass;
      skullCountEl.textContent = stats.skull;
      moaiCountEl.textContent = stats.moai;

      // Update toggle state
      toggleEnabled.checked = stats.isEnabled;
    }
  });
}

// Toggle enabled state
toggleEnabled.addEventListener('change', () => {
  chrome.runtime.sendMessage({ action: 'toggleEnabled' }, (response) => {
    if (response) {
      toggleEnabled.checked = response.isEnabled;
      // Refresh stats after toggle
      setTimeout(loadStats, 100);
    }
  });
});

// Tooltip logic
function updateTooltipPosition(e) {
  const offsetX = 15;
  const offsetY = 15;
  brutalTooltip.style.left = (e.clientX + offsetX) + 'px';
  brutalTooltip.style.top = (e.clientY + offsetY) + 'px';
}

function showTooltip(button) {
  button.addEventListener('mouseenter', () => {
    if (button.disabled) return;
    brutalTooltip.classList.add('show');
  });

  button.addEventListener('mousemove', (e) => {
    if (button.disabled) return;
    updateTooltipPosition(e);
  });

  button.addEventListener('mouseleave', () => {
    brutalTooltip.classList.remove('show');
  });
}

// Add tooltip to both dangerous buttons
showTooltip(purgeStaleBtn);
showTooltip(nukeRotBtn);

function setButtonState(button, label, disabled) {
  brutalTooltip.classList.remove('show');
  button.disabled = disabled;
  button.innerHTML = `<span class="btn-text">${label}</span>`;
}

function handleAction({ button, action, workingLabel, successLabel, defaultLabel }) {
  setButtonState(button, workingLabel, true);

  chrome.runtime.sendMessage({ action }, (response) => {
    if (chrome.runtime.lastError || !response) {
      // Reset so the user can try again if we didn't get a response
      setButtonState(button, defaultLabel, false);
      return;
    }

    setButtonState(button, successLabel, true); // stay disabled after success
    setTimeout(loadStats, 100);
  });
}

// Purge stale tabs (hourglass emoji - 1+ hours)
purgeStaleBtn.addEventListener('click', () => {
  handleAction({
    button: purgeStaleBtn,
    action: 'purgeStale',
    workingLabel: 'PURGING...',
    successLabel: 'PURGED!',
    defaultLabel: DEFAULT_PURGE_LABEL
  });
});

// Nuke the rot (skull + trash + moai emoji - 4+ hours)
nukeRotBtn.addEventListener('click', () => {
  handleAction({
    button: nukeRotBtn,
    action: 'nukeRot',
    workingLabel: 'NUKING...',
    successLabel: 'NUKED!',
    defaultLabel: DEFAULT_NUKE_LABEL
  });
});

// Load stats on popup open
loadStats();

// Refresh stats every 2 seconds while popup is open
const statsInterval = setInterval(loadStats, 2000);

// Clean up interval when popup closes to avoid late runtime.lastError logs
window.addEventListener('beforeunload', () => {
  clearInterval(statsInterval);
});
