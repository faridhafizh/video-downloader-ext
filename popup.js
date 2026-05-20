// Global map of active HLS downloads by card index
const activeDownloads = {};

document.addEventListener('DOMContentLoaded', async () => {
  const videoListDiv = document.getElementById('video-list');
  const countBadge = document.getElementById('detected-count');
  const clearBtn = document.getElementById('clear-list');

  // Helper to extract domain name
  function getDomainName(url) {
    try {
      const parsed = new URL(url);
      return parsed.hostname.replace('www.', '');
    } catch (e) {
      return 'Web Page';
    }
  }

  // Get active tab info
  let tab;
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = activeTab;
  } catch (err) {
    console.error('Error fetching active tab:', err);
  }

  if (!tab) {
    videoListDiv.innerHTML = '<div class="empty-state"><p class="empty-title">Active tab not found</p></div>';
    return;
  }

  const tabId = tab.id;

  // Clear list click handler
  clearBtn.addEventListener('click', async () => {
    // Abort all active downloads first
    Object.keys(activeDownloads).forEach(idx => {
      if (activeDownloads[idx]) {
        activeDownloads[idx].cancel();
      }
    });
    
    await chrome.runtime.sendMessage({ action: 'clearDetectedVideos', tabId });
    renderVideos([]);
  });

  // 1. Scrape active tab DOM for videos (fallback and live scan)
  try {
    // We execute script in all frames to catch videos nested inside iframes!
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: scrapeVideosFromDOM,
    });

    if (results && results.length > 0) {
      // Merge results from all frames
      const allScraped = [];
      results.forEach(res => {
        if (res.result && Array.isArray(res.result.videos)) {
          allScraped.push(...res.result.videos);
        }
      });

      if (allScraped.length > 0) {
        // Send scraped videos to background storage to merge and update badge
        await chrome.runtime.sendMessage({
          action: 'addScrapedVideos',
          tabId,
          videos: allScraped
        });
      }
    }
  } catch (err) {
    console.log('Script execution note (e.g. Chrome system pages):', err.message);
  }

  // 2. Fetch combined video list from background storage
  const renderFromStorage = () => {
    chrome.storage.local.get(`tab_${tabId}`, (data) => {
      const videos = data[`tab_${tabId}`] || [];
      renderVideos(videos);
    });
  };

  // Run render first
  renderFromStorage();

  // Listen for storage changes to update UI dynamically in real time
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[`tab_${tabId}`]) {
      renderVideos(changes[`tab_${tabId}`].newValue || []);
    }
  });

  // Render video items list
  function renderVideos(videos) {
    countBadge.textContent = videos.length;

    if (videos.length === 0) {
      videoListDiv.innerHTML = `
        <div class="empty-state">
          <svg class="empty-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          <p class="empty-title">No downloadable videos found</p>
          <p class="empty-desc">Play a video on the page, or check if the page loaded completely.</p>
        </div>
      `;
      return;
    }

    // Render list
    videoListDiv.innerHTML = '';
    videos.forEach((video, index) => {
      const card = document.createElement('div');
      card.className = 'video-card';
      card.id = `card-${index}`;

      const domain = getDomainName(video.url);
      const isHls = video.type.includes('HLS');
      const ext = isHls ? 'ts' : (video.type.toLowerCase().includes('webm') ? 'webm' : 'mp4');
      const tagClass = isHls ? 'tag-hls' : (ext === 'mp4' ? 'tag-mp4' : 'tag-other');

      // Card structure HTML
      card.innerHTML = `
        <div class="card-header">
          <div class="video-title" title="${video.title}">${video.title}</div>
          <span class="tag ${tagClass}">${isHls ? 'HLS Stream' : ext}</span>
        </div>
        <div class="card-info">
          <div class="info-item" title="Source domain">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
            </svg>
            <span>${domain}</span>
          </div>
          <div class="info-item" style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${video.url}">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            <span>Link URL</span>
          </div>
        </div>
        
        <div class="card-actions">
          <button class="btn btn-primary btn-dl-action" id="btn-dl-${index}">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            Download Video
          </button>
        </div>

        <div class="download-progress-container" id="progress-container-${index}">
          <div class="progress-header">
            <span class="progress-status" id="progress-status-${index}">Initializing...</span>
            <button class="btn-cancel" id="btn-cancel-${index}">Cancel</button>
          </div>
          <div class="progress-track">
            <div class="progress-fill" id="progress-fill-${index}"></div>
          </div>
        </div>
      `;

      videoListDiv.appendChild(card);

      // Wiring up click actions
      const dlBtn = card.querySelector(`#btn-dl-${index}`);
      const progressContainer = card.querySelector(`#progress-container-${index}`);
      const progressStatus = card.querySelector(`#progress-status-${index}`);
      const progressFill = card.querySelector(`#progress-fill-${index}`);
      const cancelBtn = card.querySelector(`#btn-cancel-${index}`);

      dlBtn.addEventListener('click', () => {
        let cleanName = video.title
          .replace(/[\\/*?:"<>|]/g, '_') // remove invalid characters
          .trim();
        if (!cleanName || cleanName === 'Detected Video') {
          cleanName = `video_${index + 1}`;
        }
        const fullFilename = `${cleanName}.${ext}`;

        if (!isHls) {
          // Standard download
          chrome.downloads.download({
            url: video.url,
            filename: fullFilename,
            saveAs: true
          });
        } else {
          // HLS Stream Downloader
          dlBtn.style.display = 'none';
          progressContainer.style.display = 'block';

          const downloader = new HLSDownloader(
            video.url,
            fullFilename,
            (statusText, progressPercent) => {
              // Progress Callback
              progressStatus.textContent = statusText;
              progressFill.style.width = `${progressPercent}%`;
            },
            () => {
              // Complete Callback
              progressContainer.style.display = 'none';
              dlBtn.style.display = 'inline-flex';
              delete activeDownloads[index];
            },
            (error) => {
              // Error Callback
              console.error(error);
              progressStatus.textContent = `Error: ${error.message}`;
              progressStatus.style.color = '#f87171';
              setTimeout(() => {
                progressContainer.style.display = 'none';
                dlBtn.style.display = 'inline-flex';
                progressStatus.style.color = '';
              }, 4000);
              delete activeDownloads[index];
            }
          );

          activeDownloads[index] = downloader;
          downloader.start();

          cancelBtn.addEventListener('click', () => {
            downloader.cancel();
          });
        }
      });
    });
  }
});

// Run in the tab context to scan DOM elements
function scrapeVideosFromDOM() {
  const videos = [];
  const pageTitle = document.title;

  // 1. Scan direct video elements
  const elements = document.querySelectorAll('video');
  elements.forEach(video => {
    let src = video.currentSrc || video.src;
    
    // Check video sources inside source tags
    if (!src) {
      const sources = video.querySelectorAll('source');
      sources.forEach(source => {
        if (source.src && !source.src.startsWith('blob:') && !source.src.startsWith('data:')) {
          videos.push({
            url: source.src,
            type: source.src.toLowerCase().includes('.m3u8') ? 'HLS (m3u8)' : 'MP4',
            title: pageTitle || 'Video Source'
          });
        }
      });
    } else if (src && !src.startsWith('blob:') && !src.startsWith('data:')) {
      videos.push({
        url: src,
        type: src.toLowerCase().includes('.m3u8') ? 'HLS (m3u8)' : 'MP4',
        title: pageTitle || 'Video Tag'
      });
    }
  });

  // 2. Scan links to video files
  const links = document.querySelectorAll('a');
  links.forEach(a => {
    const href = a.href;
    if (href) {
      const hrefLower = href.toLowerCase().split('?')[0];
      if (hrefLower.endsWith('.mp4') || hrefLower.endsWith('.webm') || hrefLower.endsWith('.ogg') || hrefLower.endsWith('.m3u8')) {
        let type = 'MP4';
        if (hrefLower.endsWith('.m3u8')) type = 'HLS (m3u8)';
        else if (hrefLower.endsWith('.webm')) type = 'WEBM';
        else if (hrefLower.endsWith('.ogg')) type = 'OGG';

        videos.push({
          url: href,
          type: type,
          title: a.textContent.trim().substring(0, 50) || pageTitle || 'Video Link'
        });
      }
    }
  });

  return {
    title: pageTitle,
    videos: videos
  };
}

/**
 * HLS Stream Downloader class for fetching segments in parallel,
 * decrypting them with AES-128 if needed, and stitching them into a TS file.
 */
class HLSDownloader {
  constructor(url, filename, progressCallback, completeCallback, errorCallback) {
    this.url = url;
    this.filename = filename;
    this.progressCallback = progressCallback;
    this.completeCallback = completeCallback;
    this.errorCallback = errorCallback;
    this.isCancelled = false;
    this.activeFetches = new Set();
  }

  cancel() {
    this.isCancelled = true;
    for (const controller of this.activeFetches) {
      controller.abort();
    }
  }

  async start() {
    try {
      this.progressCallback('Fetching playlist...', 0);
      
      // 1. Fetch main playlist
      const playlistRes = await fetch(this.url);
      if (!playlistRes.ok) throw new Error(`Failed to load playlist: HTTP ${playlistRes.status}`);
      const playlistText = await playlistRes.text();
      
      if (!playlistText.includes('#EXTM3U')) {
        throw new Error('Not a valid HLS playlist (missing #EXTM3U)');
      }
      
      let mediaPlaylistUrl = this.url;
      let mediaPlaylistText = playlistText;
      
      // 2. Resolve Master Playlist to Media Playlist
      if (playlistText.includes('#EXT-X-STREAM-INF')) {
        this.progressCallback('Parsing master stream qualities...', 5);
        const lines = playlistText.split('\n');
        let bestStreamUrl = null;
        let maxBandwidth = 0;
        
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line.startsWith('#EXT-X-STREAM-INF:')) {
            const bwMatch = line.match(/BANDWIDTH=(\d+)/i);
            const bw = bwMatch ? parseInt(bwMatch[1], 10) : 0;
            
            // The next non-empty line contains the URL
            let urlLine = '';
            for (let j = i + 1; j < lines.length; j++) {
              const checkLine = lines[j].trim();
              if (checkLine && !checkLine.startsWith('#')) {
                urlLine = checkLine;
                break;
              }
            }
            
            if (urlLine && bw > maxBandwidth) {
              maxBandwidth = bw;
              bestStreamUrl = urlLine;
            }
          }
        }
        
        if (bestStreamUrl) {
          mediaPlaylistUrl = this.resolveUrl(this.url, bestStreamUrl);
          this.progressCallback('Fetching media playlist...', 10);
          const subRes = await fetch(mediaPlaylistUrl);
          if (!subRes.ok) throw new Error(`Failed to load sub-playlist: HTTP ${subRes.status}`);
          mediaPlaylistText = await subRes.text();
        }
      }
      
      // 3. Parse segments and encryption tags
      this.progressCallback('Parsing playlist segments...', 15);
      const lines = mediaPlaylistText.split('\n');
      const segments = [];
      let keyInfo = null;
      let sequenceNum = 0;
      
      for (const line of lines) {
        if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
          sequenceNum = parseInt(line.split(':')[1].trim(), 10) || 0;
          break;
        }
      }
      
      let currentSeq = sequenceNum;
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // Intercept AES-128 Encryption Keys
        if (line.startsWith('#EXT-X-KEY:')) {
          const methodMatch = line.match(/METHOD=([^,\s]+)/);
          const uriMatch = line.match(/URI="([^"]+)"/);
          const ivMatch = line.match(/IV=0x([0-9a-fA-F]+)/);
          
          if (methodMatch && methodMatch[1] === 'AES-128') {
            const keyUri = uriMatch ? this.resolveUrl(mediaPlaylistUrl, uriMatch[1]) : null;
            let keyIv = null;
            if (ivMatch) {
              const hex = ivMatch[1];
              keyIv = new Uint8Array(hex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
            }
            keyInfo = {
              uri: keyUri,
              iv: keyIv,
              keyBuffer: null
            };
          } else if (methodMatch && methodMatch[1] === 'NONE') {
            keyInfo = null;
          } else if (methodMatch) {
            throw new Error(`Unsupported encryption method: ${methodMatch[1]}`);
          }
        }
        
        // Intercept Segment URL
        if (line.startsWith('#EXTINF:')) {
          let segmentUrlLine = '';
          for (let j = i + 1; j < lines.length; j++) {
            const checkLine = lines[j].trim();
            if (checkLine && !checkLine.startsWith('#')) {
              segmentUrlLine = checkLine;
              break;
            }
          }
          
          if (segmentUrlLine) {
            segments.push({
              url: this.resolveUrl(mediaPlaylistUrl, segmentUrlLine),
              sequence: currentSeq,
              keyInfo: keyInfo ? { ...keyInfo } : null
            });
            currentSeq++;
          }
        }
      }
      
      if (segments.length === 0) {
        throw new Error('No TS video segments found in HLS stream.');
      }
      
      // 4. Fetch the decryption key if needed
      if (keyInfo && keyInfo.uri) {
        this.progressCallback('Fetching AES decryption key...', 20);
        const keyRes = await fetch(keyInfo.uri);
        if (!keyRes.ok) throw new Error(`Failed to load AES key: HTTP ${keyRes.status}`);
        const keyBuffer = await keyRes.arrayBuffer();
        
        for (const seg of segments) {
          if (seg.keyInfo) {
            seg.keyInfo.keyBuffer = keyBuffer;
          }
        }
      }
      
      // 5. Download segments in parallel (concurrency limit = 5)
      this.progressCallback(`Starting segment downloads 0/${segments.length}...`, 25);
      const concurrency = 5;
      const results = new Array(segments.length);
      let downloadedCount = 0;
      
      const downloadSegment = async (index) => {
        if (this.isCancelled) return;
        const segment = segments[index];
        const controller = new AbortController();
        this.activeFetches.add(controller);
        
        try {
          const res = await fetch(segment.url, { signal: controller.signal });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          
          let buffer = await res.arrayBuffer();
          
          // Decrypt if necessary
          if (segment.keyInfo && segment.keyInfo.keyBuffer) {
            buffer = await this.decryptSegment(buffer, segment);
          }
          
          results[index] = buffer;
          downloadedCount++;
          
          // Calculate progress percentage mapping from 25% to 90%
          const prog = Math.floor(25 + (downloadedCount / segments.length) * 65);
          this.progressCallback(`Downloading segment ${downloadedCount}/${segments.length}`, prog);
        } catch (err) {
          if (this.isCancelled) return;
          console.warn(`Error on segment ${index}, retrying...`, err);
          // Simple retry once
          try {
            const retryRes = await fetch(segment.url, { signal: controller.signal });
            if (!retryRes.ok) throw new Error(`HTTP ${retryRes.status}`);
            let buffer = await retryRes.arrayBuffer();
            if (segment.keyInfo && segment.keyInfo.keyBuffer) {
              buffer = await this.decryptSegment(buffer, segment);
            }
            results[index] = buffer;
            downloadedCount++;
            const prog = Math.floor(25 + (downloadedCount / segments.length) * 65);
            this.progressCallback(`Downloading segment ${downloadedCount}/${segments.length}`, prog);
          } catch (retryErr) {
            throw new Error(`Segment #${index} download failed: ${retryErr.message}`);
          }
        } finally {
          this.activeFetches.delete(controller);
        }
      };
      
      // Concurrency worker queue
      const queue = [...Array(segments.length).keys()];
      const workers = [];
      
      const worker = async () => {
        while (queue.length > 0 && !this.isCancelled) {
          const idx = queue.shift();
          await downloadSegment(idx);
        }
      };
      
      for (let w = 0; w < Math.min(concurrency, segments.length); w++) {
        workers.push(worker());
      }
      
      await Promise.all(workers);
      
      if (this.isCancelled) {
        throw new Error('Cancelled');
      }
      
      // Verify download completion
      for (let i = 0; i < results.length; i++) {
        if (!results[i]) {
          throw new Error(`Download incomplete: segment ${i} missing`);
        }
      }
      
      // 6. Stitch segment buffers
      this.progressCallback('Merging video streams...', 92);
      const mergedBuffer = this.concatBuffers(results);
      
      // 7. Write to File using downloads API
      this.progressCallback('Compiling files...', 97);
      const blob = new Blob([mergedBuffer], { type: 'video/mp2t' });
      const blobUrl = URL.createObjectURL(blob);
      
      chrome.downloads.download({
        url: blobUrl,
        filename: this.filename,
        saveAs: true
      }, () => {
        setTimeout(() => URL.revokeObjectURL(blobUrl), 15000);
        this.progressCallback('Complete!', 100);
        setTimeout(() => this.completeCallback(), 1000);
      });
      
    } catch (err) {
      if (this.isCancelled || err.message === 'Cancelled') {
        this.progressCallback('Cancelled', 0);
        setTimeout(() => this.completeCallback(), 800);
      } else {
        this.errorCallback(err);
      }
    }
  }

  // Helper to resolve paths relative to current base
  resolveUrl(base, relative) {
    try {
      return new URL(relative, base).href;
    } catch (e) {
      return relative;
    }
  }

  // Web Crypto Decryption
  async decryptSegment(arrayBuffer, segment) {
    const keyInfo = segment.keyInfo;
    
    // Import Key
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyInfo.keyBuffer,
      { name: "AES-CBC" },
      false,
      ["decrypt"]
    );
    
    // Create IV: 16 bytes representing media sequence number if not explicitly defined
    let iv = keyInfo.iv;
    if (!iv) {
      iv = new Uint8Array(16);
      const seq = segment.sequence;
      iv[12] = (seq >> 24) & 0xff;
      iv[13] = (seq >> 16) & 0xff;
      iv[14] = (seq >> 8) & 0xff;
      iv[15] = seq & 0xff;
    }
    
    const decrypted = await crypto.subtle.decrypt(
      {
        name: "AES-CBC",
        iv: iv
      },
      cryptoKey,
      arrayBuffer
    );
    
    return decrypted;
  }

  // Concat buffers into one Uint8Array
  concatBuffers(buffers) {
    let totalLength = 0;
    for (const buf of buffers) {
      totalLength += buf.byteLength;
    }
    
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const buf of buffers) {
      result.set(new Uint8Array(buf), offset);
      offset += buf.byteLength;
    }
    
    return result.buffer;
  }
}