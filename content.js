/**
 * Scroll Curator v2.0 - Minimal Content Script
 * Clean, unobtrusive tweet curation
 */

(function() {
  'use strict';

  // Default settings
  const DEFAULTS = {
    threshold: 5000,
    folders: ['Most Liked', 'Read Later'],
    currentFolder: 'Most Liked',
    badgePosition: { x: null, y: null }
  };

  // State
  const state = {
    processedTweets: new Set(),
    queue: [],
    lastProcessTime: 0,
    settings: null,
    badgeInjected: false,
    savedCount: 0,
    isDragging: false,
    dragOffset: { x: 0, y: 0 },
    savedTweetIds: new Set()
  };

  // Load settings
  async function loadSettings() {
    try {
      const result = await chrome.storage.local.get('sc_settings');
      state.settings = result.sc_settings || DEFAULTS;
      state.settings = { ...DEFAULTS, ...state.settings };
      state.settings.folders = ['Most Liked', 'Read Later'];
    } catch (e) {
      state.settings = DEFAULTS;
    }
  }

  // Save settings
  async function saveSettings() {
    state.settings.folders = ['Most Liked', 'Read Later'];
    await chrome.storage.local.set({ sc_settings: state.settings });
  }

  // Load saved tweet IDs from storage
  async function loadSavedIds() {
    try {
      const allData = await chrome.storage.local.get(null);
      const newSavedIds = new Set();
      let count = 0;
      
      for (const [key, value] of Object.entries(allData)) {
        if (key.startsWith('sc_tweets_') && value.items) {
          value.items.forEach(item => {
            if (item.tweetId) {
              newSavedIds.add(item.tweetId);
              count++;
            }
          });
        }
      }
      
      state.savedTweetIds = newSavedIds;
      state.savedCount = count;
      updateBadge();
      updateAllBookmarkButtons();
      
      return newSavedIds;
    } catch (e) {
      return new Set();
    }
  }

  // Update all bookmark button states on the page
  function updateAllBookmarkButtons() {
    const bookmarks = document.querySelectorAll('.sc-bookmark');
    bookmarks.forEach(btn => {
      const tweetEl = btn.closest('article[data-testid="tweet"]');
      if (!tweetEl) return;
      
      const tweetId = tweetEl.querySelector('a[href*="/status/"]')?.getAttribute('href')?.match(/status\/(\d+)/)?.[1];
      if (!tweetId) return;
      
      if (state.savedTweetIds.has(tweetId)) {
        btn.classList.add('saved');
      } else {
        btn.classList.remove('saved');
      }
    });
  }

  // Parse like count
  function parseLikeCount(text) {
    if (!text) return 0;
    const cleaned = text.replace(/,/g, '').trim();
    
    if (cleaned.includes('K')) {
      const num = parseFloat(cleaned.replace('K', '').replace('+', ''));
      return Math.floor(num * 1000);
    }
    if (cleaned.includes('M')) {
      const num = parseFloat(cleaned.replace('M', '').replace('+', ''));
      return Math.floor(num * 1000000);
    }
    
    const parsed = parseInt(cleaned, 10);
    return isNaN(parsed) ? 0 : parsed;
  }

  // Extract engagement numbers
  function extractEngagement(tweetElement) {
    let likes = 0, retweets = 0, replies = 0;
    
    const likeEl = tweetElement.querySelector('[data-testid="like"]');
    if (likeEl) {
      const aria = likeEl.getAttribute('aria-label') || '';
      const match = aria.match(/([\d,.KM]+)[\s\w]*like/i);
      if (match) likes = parseLikeCount(match[1]);
    }
    
    const retweetEl = tweetElement.querySelector('[data-testid="retweet"], [data-testid="unretweet"]');
    if (retweetEl) {
      const aria = retweetEl.getAttribute('aria-label') || '';
      const match = aria.match(/([\d,.KM]+)\s*repost/i) || aria.match(/([\d,.KM]+)\s*retweet/i);
      if (match) retweets = parseLikeCount(match[1]);
    }
    
    const replyEl = tweetElement.querySelector('[data-testid="reply"]');
    if (replyEl) {
      const aria = replyEl.getAttribute('aria-label') || '';
      const match = aria.match(/([\d,.KM]+)[\s\w]*repl/i);
      if (match) replies = parseLikeCount(match[1]);
    }
    
    // Fallback: look for visible counts
    if (likes === 0) {
      const allSpans = tweetElement.querySelectorAll('span');
      for (const span of allSpans) {
        const text = span.textContent || '';
        if (/^[\d,.KM]+\+?$/.test(text)) {
          const parent = span.closest('[data-testid]');
          if (parent) {
            const testId = parent.getAttribute('data-testid');
            if (testId === 'like' && likes === 0) likes = parseLikeCount(text);
            else if ((testId === 'retweet' || testId === 'unretweet') && retweets === 0) retweets = parseLikeCount(text);
            else if (testId === 'reply' && replies === 0) replies = parseLikeCount(text);
          }
        }
      }
    }
    
    return { likes, retweets, replies };
  }

  // Extract tweet data with improved image capture and reply handling
  async function extractTweetData(tweetElement, folder = null) {
    try {
      // Find the main tweet text - handle replies properly
      let textEl = tweetElement.querySelector('[data-testid="tweetText"]');
      
      // If no text element found, this might be a reply-only view
      if (!textEl) {
        // Try finding text in any div with lang attribute
        const langDiv = tweetElement.querySelector('div[lang]');
        if (langDiv) textEl = langDiv;
      }
      
      if (!textEl) return null;

      const text = textEl.textContent || '';
      const tweetId = tweetElement.querySelector('a[href*="/status/"]')?.getAttribute('href')?.match(/status\/(\d+)/)?.[1] || 
                      `tweet_${Date.now()}`;

      // Author
      let author = 'unknown';
      const authorLinks = tweetElement.querySelectorAll('a[href^="/"]');
      for (const link of authorLinks) {
        const href = link.getAttribute('href');
        if (href?.match(/^\/[\w_]+$/) && !href.includes('home')) {
          author = href.replace('/', '');
          break;
        }
      }

      // Engagement
      const engagement = extractEngagement(tweetElement);

      // Timestamp
      const timeEl = tweetElement.querySelector('time');
      let timestamp = Date.now();
      let dateStr = new Date().toISOString().split('T')[0];
      if (timeEl) {
        const dt = timeEl.getAttribute('datetime');
        if (dt) {
          timestamp = new Date(dt).getTime();
          dateStr = dt.split('T')[0];
        }
      }

      // URL
      let url = '';
      if (timeEl) {
        const link = timeEl.closest('a');
        if (link) {
          const href = link.getAttribute('href');
          if (href) url = href.startsWith('http') ? href : `https://twitter.com${href}`;
        }
      }

      // Images - capture multiple sources for reliability
      const images = [];
      const processedUrls = new Set();
      
      // Helper to add image if valid
      const addImage = (url, alt = '', type = 'image') => {
        if (!url || processedUrls.has(url)) return;
        // Skip avatars and icons
        if (url.includes('pbs.twimg.com/profile_images')) return;
        if (url.includes('emoji')) return;
        if (url.includes('svg')) return;
        images.push({ url, alt, type });
        processedUrls.add(url);
      };
      
      // 1. Regular tweet photos (most reliable when loaded)
      const imgContainers = tweetElement.querySelectorAll('[data-testid="tweetPhoto"]');
      for (const container of imgContainers) {
        const img = container.querySelector('img');
        if (img?.src) {
          addImage(img.src, img.alt || '', 'photo');
        }
        // Also check for background-image on divs (Twitter's lazy-load pattern)
        const divs = container.querySelectorAll('div');
        for (const div of divs) {
          const style = window.getComputedStyle(div);
          const bgImage = style.backgroundImage;
          if (bgImage && bgImage !== 'none') {
            const url = bgImage.replace(/url\(['"]?([^'"]+)['"]?\)/, '$1');
            if (url && url.startsWith('http')) {
              addImage(url, '', 'photo');
            }
          }
        }
      }
      
      // 2. Video thumbnails
      const videos = tweetElement.querySelectorAll('video');
      for (const video of videos) {
        if (video.poster) {
          addImage(video.poster, 'Video thumbnail', 'video');
        }
        // Check for video poster in parent elements
        let parent = video.parentElement;
        for (let i = 0; i < 3 && parent; i++) {
          const style = window.getComputedStyle(parent);
          const bgImage = style.backgroundImage;
          if (bgImage && bgImage !== 'none') {
            const url = bgImage.replace(/url\(['"]?([^'"]+)['"]?\)/, '$1');
            if (url && url.startsWith('http')) {
              addImage(url, 'Video thumbnail', 'video');
            }
          }
          parent = parent.parentElement;
        }
      }
      
      // 3. Any large images in the tweet (excluding avatars)
      const allImages = tweetElement.querySelectorAll('img');
      for (const img of allImages) {
        // Skip small images (likely icons)
        if (img.width < 100 && img.height < 100) continue;
        addImage(img.src, img.alt || '', 'image');
      }
      
      // 4. Check for background images on any div (Twitter's lazy-load)
      const allDivs = tweetElement.querySelectorAll('div');
      for (const div of allDivs) {
        const style = window.getComputedStyle(div);
        const bgImage = style.backgroundImage;
        if (bgImage && bgImage !== 'none' && bgImage.includes('pbs.twimg.com')) {
          const url = bgImage.replace(/url\(['"]?([^'"]+)['"]?\)/, '$1');
          if (url && url.startsWith('http')) {
            addImage(url, '', 'photo');
          }
        }
      }

      // Links
      const links = [];
      tweetElement.querySelectorAll('a[href^="http"]').forEach(link => {
        const href = link.getAttribute('href');
        if (href && !href.includes('twitter.com') && !href.includes('x.com')) {
          links.push({ url: href, display: link.textContent || href });
        }
      });

      return {
        id: `${author}_${tweetId}_${timestamp}`,
        tweetId,
        text,
        author: `@${author}`,
        likes: engagement.likes,
        retweets: engagement.retweets,
        replies: engagement.replies,
        timestamp,
        date: dateStr,
        url,
        images,
        links,
        folder: folder || state.settings.currentFolder,
        savedAt: Date.now()
      };
    } catch (e) {
      return null;
    }
  }

  // Check if tweet matches criteria (threshold only)
  function matchesCriteria(tweet) {
    if (!state.settings) return false;
    return tweet.likes >= state.settings.threshold;
  }

  // Save tweet
  async function saveTweet(tweetData, targetFolder = null) {
    try {
      if (state.savedTweetIds.has(tweetData.tweetId)) {
        return { success: false, error: 'Already saved' };
      }

      const folder = targetFolder || tweetData.folder || 'Most Liked';
      tweetData.folder = folder;
      
      const storageKey = `sc_tweets_${tweetData.date}`;
      const result = await chrome.storage.local.get(storageKey);
      const dayData = result[storageKey] || { date: tweetData.date, items: [] };
      
      dayData.items.push(tweetData);
      await chrome.storage.local.set({ [storageKey]: dayData });
      
      state.savedTweetIds.add(tweetData.tweetId);
      state.savedCount++;
      updateBadge();
      updateBookmarkForTweet(tweetData.tweetId, true);
      showPlusOne();
      
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // Update bookmark button state for a specific tweet
  function updateBookmarkForTweet(tweetId, isSaved) {
    const bookmarks = document.querySelectorAll('.sc-bookmark');
    bookmarks.forEach(btn => {
      const tweetEl = btn.closest('article[data-testid="tweet"]');
      if (!tweetEl) return;
      
      const btnTweetId = tweetEl.querySelector('a[href*="/status/"]')?.getAttribute('href')?.match(/status\/(\d+)/)?.[1];
      if (btnTweetId === tweetId) {
        if (isSaved) {
          btn.classList.add('saved');
        } else {
          btn.classList.remove('saved');
        }
      }
    });
  }

  // Process tweet for auto-detection with delayed extraction for images
  function processTweet(tweetElement) {
    const now = Date.now();
    if (now - state.lastProcessTime < 1000) {
      state.queue.push(tweetElement);
      return;
    }
    state.lastProcessTime = now;

    // For auto-capture, we need to wait for images to lazy-load
    // Use IntersectionObserver to detect when tweet is visible, then extract
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            observer.disconnect();
            // Wait a bit more for images to actually load
            setTimeout(() => {
              extractTweetData(tweetElement).then(tweet => {
                if (!tweet) return;
                if (state.processedTweets.has(tweet.id)) return;
                state.processedTweets.add(tweet.id);

                if (matchesCriteria(tweet)) {
                  saveTweet(tweet, 'Most Liked');
                }
              });
            }, 600);
          }
        });
      }, { threshold: 0.5 });
      
      observer.observe(tweetElement);
      
      // Fallback: if observer doesn't trigger in 3 seconds, extract anyway
      setTimeout(() => {
        observer.disconnect();
        extractTweetData(tweetElement).then(tweet => {
          if (!tweet) return;
          if (state.processedTweets.has(tweet.id)) return;
          state.processedTweets.add(tweet.id);

          if (matchesCriteria(tweet)) {
            saveTweet(tweet, 'Most Liked');
          }
        });
      }, 3000);
    } else {
      // Fallback for browsers without IntersectionObserver
      setTimeout(() => {
        extractTweetData(tweetElement).then(tweet => {
          if (!tweet) return;
          if (state.processedTweets.has(tweet.id)) return;
          state.processedTweets.add(tweet.id);

          if (matchesCriteria(tweet)) {
            saveTweet(tweet, 'Most Liked');
          }
        });
      }, 1000);
    }
  }

  // Process queue
  function processQueue() {
    if (state.queue.length === 0) return;
    
    const tweet = state.queue.shift();
    if (tweet && document.contains(tweet)) {
      processTweet(tweet);
    }
    
    if (state.queue.length > 0) {
      setTimeout(processQueue, 1000);
    }
  }

  // Inject bookmark button
  function injectBookmark(tweetElement) {
    if (tweetElement.querySelector('.sc-bookmark')) return;
    
    const actionBar = tweetElement.querySelector('[role="group"]');
    if (!actionBar) return;

    const btn = document.createElement('button');
    btn.className = 'sc-bookmark';
    btn.innerHTML = '🔖';
    btn.title = 'Save to Read Later';

    const tweetId = tweetElement.querySelector('a[href*="/status/"]')?.getAttribute('href')?.match(/status\/(\d+)/)?.[1];
    if (tweetId && state.savedTweetIds.has(tweetId)) {
      btn.classList.add('saved');
    }

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      const data = await extractTweetData(tweetElement);
      if (data) {
        if (state.savedTweetIds.has(data.tweetId)) {
          showFeedback(btn, 'Already saved');
          btn.classList.add('saved');
          return;
        }
        
        const result = await saveTweet(data, 'Read Later');
        if (result.success) {
          btn.classList.add('saved');
          showFeedback(btn, 'Saved!');
        }
      }
    });

    const shareBtn = actionBar.querySelector('[data-testid="share"]');
    if (shareBtn) {
      actionBar.insertBefore(btn, shareBtn);
    } else {
      actionBar.appendChild(btn);
    }
  }

  function showFeedback(btn, text) {
    const feedback = document.createElement('span');
    feedback.className = 'sc-feedback';
    feedback.textContent = text;
    btn.appendChild(feedback);
    setTimeout(() => feedback.remove(), 1200);
  }

  // ===== MINIMAL BADGE =====

  function injectBadge() {
    // Remove existing badge if present
    const existing = document.getElementById('sc-badge');
    if (existing) existing.remove();
    
    const badge = document.createElement('div');
    badge.id = 'sc-badge';
    badge.className = state.savedCount > 0 ? 'has-items' : 'empty';
    
    const pos = state.settings?.badgePosition;
    if (pos?.x !== null && pos?.y !== null) {
      badge.style.left = `${pos.x}px`;
      badge.style.top = `${pos.y}px`;
      badge.style.right = 'auto';
    } else {
      badge.style.top = '80px';
      badge.style.right = '20px';
      badge.style.left = 'auto';
    }
    
    badge.innerHTML = `
      <span class="sc-count">${state.savedCount}</span>
      <span class="sc-plus">+1</span>
    `;
    
    document.body.appendChild(badge);
    
    badge.addEventListener('mousedown', startDrag);
    badge.addEventListener('click', (e) => {
      if (!state.isDragging) {
        chrome.runtime.sendMessage({ action: 'openPopup' });
      }
    });
    
    state.badgeInjected = true;
  }

  function updateBadge() {
    const badge = document.getElementById('sc-badge');
    if (!badge) {
      // Badge missing, recreate it
      injectBadge();
      return;
    }
    
    const countEl = badge.querySelector('.sc-count');
    if (countEl) countEl.textContent = state.savedCount;
    
    badge.className = state.savedCount > 0 ? 'has-items' : 'empty';
  }

  function showPlusOne() {
    const badge = document.getElementById('sc-badge');
    if (!badge) return;
    
    badge.classList.add('show-plus');
    setTimeout(() => badge.classList.remove('show-plus'), 800);
  }

  // Drag badge
  function startDrag(e) {
    e.preventDefault();
    state.isDragging = false;
    
    const badge = document.getElementById('sc-badge');
    const rect = badge.getBoundingClientRect();
    state.dragOffset = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
    
    const onMove = (ev) => {
      state.isDragging = true;
      
      let x = ev.clientX - state.dragOffset.x;
      let y = ev.clientY - state.dragOffset.y;
      
      x = Math.max(10, Math.min(x, window.innerWidth - 60));
      y = Math.max(10, Math.min(y, window.innerHeight - 40));
      
      badge.style.left = `${x}px`;
      badge.style.top = `${y}px`;
      badge.style.right = 'auto';
    };
    
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      
      if (state.isDragging) {
        const rect = badge.getBoundingClientRect();
        state.settings.badgePosition = { x: rect.left, y: rect.top };
        saveSettings();
      }
      
      setTimeout(() => { state.isDragging = false; }, 100);
    };
    
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // Ensure badge exists with multiple checks
  function ensureBadge() {
    const badge = document.getElementById('sc-badge');
    if (!badge || !document.body.contains(badge)) {
      state.badgeInjected = false;
      injectBadge();
    }
  }

  // Observe DOM
  function observe() {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach(m => {
        m.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.matches?.('article[data-testid="tweet"]')) {
              state.queue.push(node);
              injectBookmark(node);
            }
            
            const tweets = node.querySelectorAll?.('article[data-testid="tweet"]') || [];
            tweets.forEach(t => {
              state.queue.push(t);
              injectBookmark(t);
            });
          }
        });
      });
      
      if (state.queue.length > 0) {
        processQueue();
      }
    });
    
    observer.observe(document.body, { childList: true, subtree: true });
    
    // Check badge more frequently (every 2 seconds)
    setInterval(ensureBadge, 2000);
    
    // Also check immediately after any potential page navigation
    window.addEventListener('popstate', ensureBadge);
    window.addEventListener('pushstate', ensureBadge);
  }

  // Initialize
  async function init() {
    await loadSettings();
    await loadSavedIds();
    injectBadge();
    observe();
    
    document.querySelectorAll('article[data-testid="tweet"]').forEach(t => {
      injectBookmark(t);
    });
  }

  // Listen for messages from popup
  chrome.runtime.onMessage?.addListener((request, sender, sendResponse) => {
    if (request.action === 'settingsUpdated') {
      loadSettings().then(() => {
        updateBadge();
      });
    }
    if (request.action === 'refreshCount') {
      loadSavedIds();
    }
    if (request.action === 'tweetDeleted' && request.tweetId) {
      state.savedTweetIds.delete(request.tweetId);
      state.savedCount = Math.max(0, state.savedCount - 1);
      updateBadge();
      updateBookmarkForTweet(request.tweetId, false);
    }
  });

  // Listen for storage changes
  chrome.storage.onChanged?.addListener((changes, area) => {
    if (area === 'local') {
      const tweetKeysChanged = Object.keys(changes).some(key => 
        key.startsWith('sc_tweets_')
      );
      
      if (tweetKeysChanged) {
        loadSavedIds();
      }
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
