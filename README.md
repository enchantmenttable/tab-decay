# TAB DECAY 🗑️

A neo-brutalist Chrome extension that aggressively combats tab hoarding by adding emoji decay indicators to stale tabs.

## Features

- **Automatic Tab Decay**: Tabs get emoji prefixes based on inactivity
  - ⏳ 1-4 hours inactive
  - 💀 4-8 hours inactive
  - 🗑️ 8 hours - 2 days inactive
  - 🗿 2+ days inactive

- **Neo-Brutalist UI**: Raw, high-contrast popup with:
  - Receipt-style stats display
  - Chunky monospace typography
  - Hard shadows and thick borders
  - Aggressive accent colors

- **Tab Management**:
  - Toggle decay mode on/off
  - Purge stale tabs (💀 - 4+ hours)
  - Nuke rotten tabs (🗑️ & 🗿 - 8+ hours)

## Installation

### Option 1: Load Unpacked (Development)

1. **Add Icons** (Required):
   - Navigate to the `icons/` folder
   - Add three PNG files: `icon16.png`, `icon48.png`, and `icon128.png`
   - See `icons/README.md` for design suggestions

2. **Open Chrome Extensions**:
   - Navigate to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top-right corner)

3. **Load the Extension**:
   - Click "Load unpacked"
   - Select the `tab-decay` folder

4. **Pin the Extension**:
   - Click the puzzle piece icon in Chrome toolbar
   - Find "Tab Decay" and click the pin icon

### Option 2: Package for Distribution

1. Complete Step 1 from Option 1 (add icons)
2. In `chrome://extensions/`, click "Pack extension"
3. Select the `tab-decay` folder
4. Chrome will create a `.crx` file you can share

## Usage

### Opening the Control Panel
Click the Tab Decay icon in your Chrome toolbar to open the neo-brutalist control panel.

### Toggle Decay Mode
Use the toggle switch to enable/disable emoji prefixes. When disabled, all tabs return to their original titles.

### Purging Tabs
- **PURGE STALE 💀**: Closes all tabs inactive for 4+ hours
- **NUKE THE ROT 🗑️ & 🗿**: Closes all tabs inactive for 8+ hours (nuclear option)

### Stats Display
The receipt-style interface shows:
- Total tab count
- Tabs in each decay stage
- Approximate RAM usage

## How It Works

1. **Tab Tracking**: The background service worker tracks when you last focused each tab
2. **Title Modification**: After thresholds are met, emoji prefixes are added to tab titles
3. **Persistent Storage**: Tab metadata is saved to Chrome's local storage
4. **Auto-Refresh**: Titles update every minute to reflect current decay state

## Customization

### Adjusting Time Thresholds
Edit [background.js:4-9](background.js#L4-L9):

```javascript
const DECAY_THRESHOLDS = {
  HOURGLASS: 1 * 60 * 60 * 1000,      // 1 hour
  SKULL: 4 * 60 * 60 * 1000,          // 4 hours
  TRASH: 8 * 60 * 60 * 1000,          // 8 hours
  MOAI: 2 * 24 * 60 * 60 * 1000       // 2 days
};
```

### Changing Emojis
Edit [background.js:11-16](background.js#L11-L16):

```javascript
const EMOJIS = {
  HOURGLASS: '⏳',
  SKULL: '💀',
  TRASH: '🗑️',
  MOAI: '🗿'
};
```

### Styling the Popup
Edit [popup.css](popup.css) to customize colors, borders, shadows, and typography.

## Permissions

- **tabs**: Read tab information and close tabs
- **storage**: Save tab metadata and settings

## Technical Details

- **Manifest Version**: 3
- **Background**: Service Worker (modern Chrome extensions)
- **Storage**: Chrome Local Storage API
- **Script Injection**: Used to modify tab titles

## Troubleshooting

### Emojis not appearing
- Some tabs (chrome://, browser settings) cannot be modified
- Check that Decay Mode is toggled ON
- Try refreshing the page

### Stats not updating
- Reopen the popup
- Check browser console for errors (F12)

### Extension not loading
- Ensure all three icon files exist in `icons/` folder
- Check for syntax errors in console
- Try removing and re-adding the extension

## Browser Compatibility

- Chrome/Chromium-based browsers (Chrome, Edge, Brave, etc.)
- Requires Manifest V3 support

## License

MIT License - Do whatever you want with this code.

## Credits

Built with aggressive minimalism and zero tolerance for tab hoarding.

---

**YOUR BROWSER IS SCREAMING... CLOSE SOME TABS...**
