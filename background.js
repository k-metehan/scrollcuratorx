/**
 * Scroll Curator v2.0 - Background Service Worker
 * Storage management and image compression
 */

const CONFIG = {
  MAX_STORAGE_BYTES: 1024 * 1024 * 1024, // 1GB
  IMAGE_QUALITY: 0.8,
  MAX_IMAGE_WIDTH: 1200
};

// Calculate storage usage
async function getStorageUsage() {
  try {
    const allData = await chrome.storage.local.get(null);
    let totalBytes = 0;
    let textBytes = 0;
    let imageBytes = 0;
    let itemCount = 0;
    
    for (const [key, value] of Object.entries(allData)) {
      // Skip settings
      if (key === 'sc_settings') {
        const bytes = new Blob([JSON.stringify(value)]).size;
        totalBytes += bytes;
        continue;
      }
      
      if (!key.startsWith('sc_tweets_')) continue;
      
      const str = JSON.stringify(value);
      const bytes = new Blob([str]).size;
      totalBytes += bytes;
      
      if (value.items) {
        value.items.forEach(item => {
          itemCount++;
          // Rough estimate for images
          if (item.images?.length > 0) {
            item.images.forEach(img => {
              if (img.dataUrl) {
                imageBytes += new Blob([img.dataUrl]).size * 0.75; // base64 is ~33% larger
              }
            });
          }
        });
      }
    }
    
    textBytes = totalBytes - imageBytes;
    
    return {
      totalBytes,
      textBytes,
      imageBytes,
      itemCount,
      maxBytes: CONFIG.MAX_STORAGE_BYTES,
      percentUsed: (totalBytes / CONFIG.MAX_STORAGE_BYTES * 100).toFixed(1)
    };
  } catch (error) {
    console.error('Scroll Curator: Error calculating storage:', error);
    return {
      totalBytes: 0,
      textBytes: 0,
      imageBytes: 0,
      itemCount: 0,
      maxBytes: CONFIG.MAX_STORAGE_BYTES,
      percentUsed: '0.0'
    };
  }
}

// Check storage room
async function hasStorageRoom(requiredBytes = 5 * 1024 * 1024) {
  const usage = await getStorageUsage();
  return (CONFIG.MAX_STORAGE_BYTES - usage.totalBytes) >= requiredBytes;
}

// Get oldest items for cleanup
async function getOldestItems(count = 10) {
  try {
    const allData = await chrome.storage.local.get(null);
    let allItems = [];
    
    for (const [key, value] of Object.entries(allData)) {
      if (!key.startsWith('sc_tweets_')) continue;
      
      if (value.items) {
        value.items.forEach(item => {
          allItems.push({
            ...item,
            storageKey: key
          });
        });
      }
    }
    
    allItems.sort((a, b) => (a.savedAt || a.timestamp) - (b.savedAt || b.timestamp));
    return allItems.slice(0, count);
  } catch (error) {
    return [];
  }
}

// Cleanup old items
async function cleanupOldItems(bytesToFree = 50 * 1024 * 1024) {
  let freed = 0;
  const items = await getOldestItems(20);
  
  for (const item of items) {
    if (freed >= bytesToFree) break;
    
    const result = await chrome.storage.local.get(item.storageKey);
    const data = result[item.storageKey];
    
    if (data) {
      data.items = data.items.filter(i => i.id !== item.id);
      await chrome.storage.local.set({ [item.storageKey]: data });
      
      const size = new Blob([JSON.stringify(item)]).size;
      freed += size;
    }
  }
  
  return freed;
}

// Compress image
async function compressImage(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let w = img.width;
      let h = img.height;
      
      if (w > CONFIG.MAX_IMAGE_WIDTH) {
        h = (h * CONFIG.MAX_IMAGE_WIDTH) / w;
        w = CONFIG.MAX_IMAGE_WIDTH;
      }
      
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      
      resolve(canvas.toDataURL('image/jpeg', CONFIG.IMAGE_QUALITY));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

// Handle messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    try {
      switch (request.action) {
        case 'getStorageUsage':
          const usage = await getStorageUsage();
          sendResponse({ success: true, usage });
          break;
          
        case 'hasStorageRoom':
          const hasRoom = await hasStorageRoom(request.requiredBytes);
          sendResponse({ success: true, hasRoom });
          break;
          
        case 'cleanupStorage':
          const freed = await cleanupOldItems(request.bytesToFree);
          sendResponse({ success: true, freed });
          break;
          
        case 'compressImage':
          const compressed = await compressImage(request.dataUrl);
          sendResponse({ success: true, compressed });
          break;
          
        case 'openPopup':
          chrome.action.openPopup();
          sendResponse({ success: true });
          break;
          
        default:
          sendResponse({ success: false, error: 'Unknown action' });
      }
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
  })();
  
  return true;
});

// Initialize
console.log('Scroll Curator v2.0: Background service worker initialized');
