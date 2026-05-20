// Store detected video URLs by tab ID
// Structure: { [tabId]: [ { url: string, type: string, filename: string, title: string, detectedAt: number }, ... ] }
const detectedVideos = {};

// Clean up stored videos when a tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  delete detectedVideos[tabId];
  chrome.storage.local.remove(`tab_${tabId}`);
});

// Clean up when navigating to a new page
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  // Only clear for the main frame navigation
  if (details.frameId === 0) {
    detectedVideos[details.tabId] = [];
    chrome.storage.local.remove(`tab_${details.tabId}`);
    updateBadge(details.tabId);
  }
});

// Helper to determine video type from URL
function getVideoType(url) {
  try {
    const urlObj = new URL(url);
    const path = urlObj.pathname.toLowerCase();
    if (path.includes('.m3u8')) return 'HLS (m3u8)';
    if (path.includes('.mpd')) return 'DASH (mpd)';
    if (path.includes('.mp4')) return 'MP4';
    if (path.includes('.webm')) return 'WEBM';
    if (path.includes('.ogg') || path.includes('.ogv')) return 'OGG';
    
    // Check search params as well
    const search = urlObj.search.toLowerCase();
    if (search.includes('.m3u8') || search.includes('m3u8')) return 'HLS (m3u8)';
    if (search.includes('.mpd') || search.includes('mpd')) return 'DASH (mpd)';
    if (search.includes('.mp4')) return 'MP4';
    
    return 'Video';
  } catch (e) {
    return 'Video';
  }
}

// Helper to extract a friendly filename
function getFriendlyFilename(url, type) {
  try {
    const urlObj = new URL(url);
    let name = urlObj.pathname.substring(urlObj.pathname.lastIndexOf('/') + 1);
    name = decodeURIComponent(name).split('?')[0];
    if (!name || name === 'index.m3u8' || name === 'manifest.mpd' || name === 'video.mp4') {
      return '';
    }
    return name;
  } catch (e) {
    return '';
  }
}

// Add a video to the detected list for a tab
function addDetectedVideo(tabId, url, type, title = '') {
  if (!detectedVideos[tabId]) {
    detectedVideos[tabId] = [];
  }
  
  // Avoid duplicate URLs in the list
  const exists = detectedVideos[tabId].some(v => v.url === url);
  if (!exists) {
    const filename = getFriendlyFilename(url, type);
    const pageTitle = title || filename || 'Detected Video';
    
    detectedVideos[tabId].push({
      url,
      type,
      filename,
      title: pageTitle,
      detectedAt: Date.now()
    });
    
    updateBadge(tabId);
    
    // Save to storage so the popup can retrieve it
    chrome.storage.local.set({ [`tab_${tabId}`]: detectedVideos[tabId] });
  }
}

// Update the badge count for a tab
function updateBadge(tabId) {
  const count = detectedVideos[tabId] ? detectedVideos[tabId].length : 0;
  chrome.action.setBadgeText({
    tabId: tabId,
    text: count > 0 ? count.toString() : ''
  });
  chrome.action.setBadgeBackgroundColor({
    tabId: tabId,
    color: '#6366f1' // Indigo accent color
  });
}

// Intercept network requests
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const { url, tabId } = details;
    
    // Ignore internal extension requests or invalid tab IDs
    if (tabId === -1 || tabId === undefined) return;
    
    const urlLower = url.toLowerCase();
    
    // Ignore standard JS/CSS or tracking queries unless they specifically target media
    if (urlLower.includes('.js') || urlLower.includes('.css') || urlLower.includes('.png') || urlLower.includes('.jpg') || urlLower.includes('.gif') || urlLower.includes('.svg')) {
      return;
    }
    
    // Filter conditions for videos
    let type = null;
    if (urlLower.includes('.m3u8') || urlLower.includes('/m3u8') || urlLower.includes('.m3u8?')) {
      type = 'HLS (m3u8)';
    } else if (urlLower.includes('.mp4') || urlLower.includes('/mp4/') || urlLower.includes('.mp4?')) {
      type = 'MP4';
    } else if (urlLower.includes('.webm') || urlLower.includes('/webm/') || urlLower.includes('.webm?')) {
      type = 'WEBM';
    } else if (urlLower.includes('.mpd') || urlLower.includes('/mpd/') || urlLower.includes('.mpd?')) {
      type = 'DASH (mpd)';
    } else if (urlLower.includes('.ts') && !urlLower.includes('m3u8')) {
      // Don't capture individual .ts segments if they are loaded directly, as we only want the m3u8 playlist
      return;
    }
    
    if (type) {
      addDetectedVideo(tabId, url, type);
    }
  },
  { urls: ["<all_urls>"] }
);

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getDetectedVideos') {
    const tabId = message.tabId;
    sendResponse({ videos: detectedVideos[tabId] || [] });
  } else if (message.action === 'addScrapedVideos') {
    const { tabId, videos } = message;
    if (videos && Array.isArray(videos)) {
      videos.forEach(v => {
        addDetectedVideo(tabId, v.url, v.type, v.title);
      });
    }
    sendResponse({ success: true });
  } else if (message.action === 'clearDetectedVideos') {
    const tabId = message.tabId;
    detectedVideos[tabId] = [];
    chrome.storage.local.remove(`tab_${tabId}`);
    updateBadge(tabId);
    sendResponse({ success: true });
  }
  return true; // Keep message channel open for async response
});
