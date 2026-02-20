/**
 * Scroll Curator v2.0 - Popup Script
 * Two-page interface with search and filter
 */

(function() {
  'use strict';

  const FOLDERS = ['Most Liked', 'Read Later'];
  
  const DEFAULTS = {
    threshold: 5000,
    folders: FOLDERS,
    currentFolder: 'Most Liked',
    badgePosition: { x: null, y: null }
  };

  // State
  let settings = {};
  let allTweets = [];
  let filteredTweets = [];
  let currentFolder = 'Most Liked';
  let storageUsage = null;
  
  // Filter state
  let filters = {
    search: '',
    dateRange: 'all',
    dateFrom: null,
    dateTo: null,
    minEngagement: 0
  };

  // Elements
  const els = {
    mainPage: document.getElementById('main-page'),
    settingsPage: document.getElementById('settings-page'),
    folderTabs: document.getElementById('folder-tabs'),
    tweetsList: document.getElementById('tweets-list'),
    emptyState: document.getElementById('empty-state'),
    footerCount: document.getElementById('footer-count'),
    settingsBtn: document.getElementById('settings-btn'),
    backBtn: document.getElementById('back-btn'),
    thresholdSlider: document.getElementById('threshold-slider'),
    thresholdDisplay: document.getElementById('threshold-display'),
    storageFill: document.getElementById('storage-fill'),
    storageText: document.getElementById('storage-text'),
    exportTodayBtn: document.getElementById('export-today-btn'),
    exportAllBtn: document.getElementById('export-all-btn'),
    clearAllBtn: document.getElementById('clear-all-btn'),
    confirmModal: document.getElementById('confirm-modal'),
    cancelClear: document.getElementById('cancel-clear'),
    confirmClear: document.getElementById('confirm-clear'),
    toast: document.getElementById('toast'),
    // Search & Filter
    searchInput: document.getElementById('search-input'),
    filterToggle: document.getElementById('filter-toggle'),
    filterPanel: document.getElementById('filter-panel'),
    dateBtns: document.querySelectorAll('.date-btn'),
    customDate: document.getElementById('custom-date'),
    dateFrom: document.getElementById('date-from'),
    dateTo: document.getElementById('date-to'),
    engagementFilter: document.getElementById('engagement-filter'),
    clearFilters: document.getElementById('clear-filters')
  };

  // Initialize
  async function init() {
    await loadSettings();
    await loadTweets();
    await loadStorageUsage();
    
    currentFolder = settings.currentFolder || 'Most Liked';
    
    renderFolderTabs();
    applyFilters();
    renderSettings();
    setupEventListeners();
  }

  // Load settings
  async function loadSettings() {
    try {
      const result = await chrome.storage.local.get('sc_settings');
      settings = { ...DEFAULTS, ...(result.sc_settings || {}) };
      settings.folders = FOLDERS;
    } catch (e) {
      settings = DEFAULTS;
    }
  }

  // Save settings
  async function saveSettings() {
    settings.folders = FOLDERS;
    await chrome.storage.local.set({ sc_settings: settings });
    chrome.runtime.sendMessage({ action: 'settingsUpdated' });
  }

  // Load ALL tweets
  async function loadTweets() {
    allTweets = [];
    try {
      const allData = await chrome.storage.local.get(null);
      
      for (const [key, value] of Object.entries(allData)) {
        if (key === 'sc_settings') continue;
        
        if (key.startsWith('sc_tweets_') && value && Array.isArray(value.items)) {
          value.items.forEach(item => {
            allTweets.push(item);
          });
        }
      }
      
      allTweets.sort((a, b) => (b.savedAt || b.timestamp || 0) - (a.savedAt || a.timestamp || 0));
    } catch (e) {
      // Silent fail
    }
  }

  // Load storage usage
  async function loadStorageUsage() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'getStorageUsage' }, (response) => {
        if (response?.success) {
          storageUsage = response.usage;
        }
        resolve();
      });
    });
  }

  // Format helpers
  function formatBytes(bytes) {
    if (bytes === 0) return '0 MB';
    const mb = bytes / (1024 * 1024);
    if (mb < 1) return (bytes / 1024).toFixed(0) + ' KB';
    if (mb < 1024) return mb.toFixed(1) + ' MB';
    return (mb / 1024).toFixed(2) + ' GB';
  }

  function formatNum(num) {
    if (!num || num === 0) return '0';
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  }

  function getTodayString() {
    return new Date().toISOString().split('T')[0];
  }

  function isToday(timestamp) {
    if (!timestamp) return false;
    const date = new Date(timestamp);
    const today = new Date();
    return date.getDate() === today.getDate() &&
           date.getMonth() === today.getMonth() &&
           date.getFullYear() === today.getFullYear();
  }

  function isWithinDays(timestamp, days) {
    if (!timestamp) return false;
    const date = new Date(timestamp);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return date >= cutoff;
  }

  function isWithinDateRange(timestamp, from, to) {
    if (!timestamp) return false;
    const date = new Date(timestamp);
    if (from && date < new Date(from)) return false;
    if (to && date > new Date(to + 'T23:59:59')) return false;
    return true;
  }

  // ===== FILTER LOGIC =====

  function applyFilters() {
    let result = allTweets.filter(t => t.folder === currentFolder);
    
    // Search filter
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      result = result.filter(t => 
        (t.text && t.text.toLowerCase().includes(searchLower)) ||
        (t.author && t.author.toLowerCase().includes(searchLower))
      );
    }
    
    // Date range filter (based on savedAt)
    if (filters.dateRange !== 'all') {
      if (filters.dateRange === '7') {
        result = result.filter(t => isWithinDays(t.savedAt, 7));
      } else if (filters.dateRange === '30') {
        result = result.filter(t => isWithinDays(t.savedAt, 30));
      } else if (filters.dateRange === 'custom') {
        result = result.filter(t => isWithinDateRange(t.savedAt, filters.dateFrom, filters.dateTo));
      }
    }
    
    // Engagement filter
    if (filters.minEngagement > 0) {
      result = result.filter(t => (t.likes || 0) >= filters.minEngagement);
    }
    
    filteredTweets = result;
    renderTweets();
  }

  // ===== RENDER =====

  function renderFolderTabs() {
    els.folderTabs.innerHTML = '';
    
    FOLDERS.forEach(folder => {
      const btn = document.createElement('button');
      btn.className = 'folder-tab' + (folder === currentFolder ? ' active' : '');
      btn.textContent = folder;
      btn.onclick = () => {
        currentFolder = folder;
        settings.currentFolder = folder;
        saveSettings();
        renderFolderTabs();
        applyFilters();
      };
      els.folderTabs.appendChild(btn);
    });
  }

  function renderTweets() {
    // Update hints
    const hintMost = document.getElementById('folder-hint-most');
    const hintRead = document.getElementById('folder-hint-read');
    if (hintMost && hintRead) {
      hintMost.style.display = currentFolder === 'Most Liked' ? '' : 'none';
      hintRead.style.display = currentFolder === 'Read Later' ? '' : 'none';
    }
    
    if (filteredTweets.length === 0) {
      els.tweetsList.innerHTML = '';
      els.tweetsList.appendChild(els.emptyState);
      els.emptyState.style.display = 'flex';
    } else {
      els.emptyState.style.display = 'none';
      els.tweetsList.innerHTML = '';
      
      filteredTweets.forEach(tweet => {
        const card = createTweetCard(tweet);
        els.tweetsList.appendChild(card);
      });
    }
    
    els.footerCount.textContent = `${filteredTweets.length} item${filteredTweets.length !== 1 ? 's' : ''}`;
  }

  function createTweetCard(tweet) {
    const card = document.createElement('div');
    card.className = 'tweet-card';
    card.dataset.id = tweet.id;
    
    let engagementHtml = `<span>❤ ${formatNum(tweet.likes || 0)}</span>`;
    if (tweet.retweets && tweet.retweets > 0) {
      engagementHtml += `<span>🔄 ${formatNum(tweet.retweets)}</span>`;
    }
    if (tweet.replies && tweet.replies > 0) {
      engagementHtml += `<span>💬 ${formatNum(tweet.replies)}</span>`;
    }
    
    let html = '';
    
    // Thumbnail with fallback
    if (tweet.images?.length > 0) {
      const imgUrl = tweet.images[0].url;
      html += `
        <div class="tweet-thumbnail">
          <img src="${imgUrl}" alt="" loading="lazy" onerror="this.style.display='none'">
        </div>
      `;
    }
    
    const text = tweet.text?.slice(0, 140) + (tweet.text?.length > 140 ? '...' : '') || '';
    html += `<div class="tweet-text">${escapeHtml(text)}</div>`;
    
    html += `
      <div class="tweet-meta">
        <span class="tweet-author">${escapeHtml(tweet.author || '@unknown')}</span>
        <div class="tweet-engagement">${engagementHtml}</div>
      </div>
    `;
    
    html += `
      <div class="tweet-actions">
        ${tweet.url ? `<a href="${tweet.url}" target="_blank" class="tweet-link">View →</a>` : ''}
        <button class="tweet-delete" data-id="${tweet.id}">Delete</button>
      </div>
    `;
    
    card.innerHTML = html;
    
    card.addEventListener('click', (e) => {
      if (e.target.closest('.tweet-delete') || e.target.closest('.tweet-link')) return;
      openTweetModal(tweet);
    });
    
    card.querySelector('.tweet-delete').onclick = (e) => {
      e.stopPropagation();
      deleteTweet(tweet);
    };
    
    return card;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ===== MODAL =====

  function openTweetModal(tweet) {
    const existing = document.getElementById('tweet-modal');
    if (existing) existing.remove();
    
    const modal = document.createElement('div');
    modal.id = 'tweet-modal';
    modal.className = 'tweet-modal';
    
    let engagementHtml = `<span class="engagement-item">❤ ${formatNum(tweet.likes || 0)} likes</span>`;
    if (tweet.retweets && tweet.retweets > 0) {
      engagementHtml += `<span class="engagement-item">🔄 ${formatNum(tweet.retweets)} retweets</span>`;
    }
    if (tweet.replies && tweet.replies > 0) {
      engagementHtml += `<span class="engagement-item">💬 ${formatNum(tweet.replies)} replies</span>`;
    }
    
    let imagesHtml = '';
    if (tweet.images?.length > 0) {
      imagesHtml = `<div class="modal-images">`;
      tweet.images.forEach((img) => {
        imagesHtml += `<img src="${img.url}" alt="${img.alt || ''}" class="modal-image" onerror="this.style.display='none'">`;
      });
      imagesHtml += `</div>`;
    }
    
    const savedDate = tweet.savedAt ? new Date(tweet.savedAt).toLocaleString() : 'Unknown';
    
    modal.innerHTML = `
      <div class="modal-overlay"></div>
      <div class="modal-content">
        <div class="modal-header">
          <span class="modal-author">${escapeHtml(tweet.author || '@unknown')}</span>
          <div class="modal-menu">
            <button class="menu-btn">⋮</button>
            <div class="menu-dropdown hidden">
              <button class="menu-item copy-md">📋 Copy as Markdown</button>
            </div>
          </div>
          <button class="modal-close">×</button>
        </div>
        
        ${imagesHtml}
        
        <div class="modal-text">${escapeHtml(tweet.text || '')}</div>
        
        <div class="modal-meta">
          <div class="modal-engagement">${engagementHtml}</div>
          <div class="modal-date">Saved: ${savedDate}</div>
        </div>
        
        ${tweet.url ? `<a href="${tweet.url}" target="_blank" class="modal-view-btn">Open on Twitter →</a>` : ''}
      </div>
    `;
    
    document.body.appendChild(modal);
    
    modal.querySelector('.modal-close').onclick = () => modal.remove();
    modal.querySelector('.modal-overlay').onclick = () => modal.remove();
    
    const menuBtn = modal.querySelector('.menu-btn');
    const menuDropdown = modal.querySelector('.menu-dropdown');
    
    menuBtn.onclick = (e) => {
      e.stopPropagation();
      menuDropdown.classList.toggle('hidden');
    };
    
    document.addEventListener('click', function closeMenu(e) {
      if (!e.target.closest('.modal-menu')) {
        menuDropdown.classList.add('hidden');
        document.removeEventListener('click', closeMenu);
      }
    });
    
    modal.querySelector('.copy-md').onclick = () => {
      copyAsMarkdown(tweet);
      menuDropdown.classList.add('hidden');
    };
  }

  function copyAsMarkdown(tweet) {
    const dateStr = tweet.savedAt ? new Date(tweet.savedAt).toLocaleDateString('en-US', { 
      month: 'short', day: 'numeric', year: 'numeric' 
    }) : 'Unknown date';
    
    let markdown = `> ${(tweet.text || '').replace(/\n/g, '\n> ')}\n\n`;
    
    if (tweet.images?.length > 0) {
      tweet.images.forEach(img => {
        markdown += `![${img.alt || 'Image'}](${img.url})\n\n`;
      });
    }
    
    const engagement = [];
    if (tweet.likes) engagement.push(`${formatNum(tweet.likes)} likes`);
    if (tweet.retweets) engagement.push(`${formatNum(tweet.retweets)} retweets`);
    
    markdown += `— ${tweet.author || '@unknown'}`;
    if (engagement.length > 0) {
      markdown += ` | ${engagement.join(', ')}`;
    }
    if (tweet.url) {
      markdown += ` | [View on Twitter](${tweet.url})`;
    }
    markdown += ` | ${dateStr}`;
    
    navigator.clipboard.writeText(markdown).then(() => {
      showToast('Copied to clipboard!', 'success');
    }).catch(() => {
      showToast('Failed to copy', 'error');
    });
  }

  // ===== DELETE =====

  async function deleteTweet(tweet) {
    try {
      const key = `sc_tweets_${tweet.date}`;
      const result = await chrome.storage.local.get(key);
      const data = result[key];
      
      if (data) {
        data.items = data.items.filter(i => i.id !== tweet.id);
        await chrome.storage.local.set({ [key]: data });
      }
      
      allTweets = allTweets.filter(t => t.id !== tweet.id);
      applyFilters();
      
      if (tweet.tweetId) {
        chrome.runtime.sendMessage({ 
          action: 'tweetDeleted', 
          tweetId: tweet.tweetId 
        });
      }
      
      chrome.runtime.sendMessage({ action: 'refreshCount' });
      showToast('Deleted', 'success');
    } catch (e) {
      showToast('Error deleting', 'error');
    }
  }

  // ===== EXPORT =====

  async function exportTweets(tweetsToExport, filename) {
    if (!tweetsToExport || tweetsToExport.length === 0) {
      showToast('No tweets to export', 'error');
      return;
    }
    
    let md = `# Scroll Curator Export\n\n`;
    md += `**Export Date:** ${new Date().toLocaleString()}  \n`;
    md += `**Items:** ${tweetsToExport.length}\n\n---\n\n`;
    
    tweetsToExport.forEach((t, i) => {
      md += `## ${i + 1}. ${escapeHtml(t.author || '@unknown')}\n\n`;
      
      if (t.images?.length > 0) {
        t.images.forEach(img => {
          md += `![${img.alt || 'Image'}](${img.url})\n\n`;
        });
      }
      
      md += `> ${(t.text || '').replace(/\n/g, '\n> ')}\n\n`;
      
      const engagement = [];
      if (t.likes) engagement.push(`❤ ${formatNum(t.likes)} likes`);
      if (t.retweets) engagement.push(`🔄 ${formatNum(t.retweets)} retweets`);
      if (t.replies) engagement.push(`💬 ${formatNum(t.replies)} replies`);
      
      if (engagement.length > 0) {
        md += engagement.join(' · ') + '  \n';
      }
      
      md += `**Folder:** ${t.folder || 'Most Liked'}  \n`;
      if (t.url) md += `**Link:** [View on Twitter](${t.url})  \n`;
      
      const savedDate = t.savedAt ? new Date(t.savedAt).toLocaleString() : 'Unknown';
      md += `**Saved:** ${savedDate}\n\n---\n\n`;
    });
    
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    
    try {
      await chrome.downloads.download({
        url: url,
        filename: filename,
        saveAs: false
      });
      showToast('Exported successfully', 'success');
    } catch (e) {
      showToast('Export failed', 'error');
    }
    
    URL.revokeObjectURL(url);
  }

  function exportToday() {
    const todayBookmarks = allTweets.filter(t => isToday(t.savedAt));
    exportTweets(todayBookmarks, `scroll-curator-bookmarks-${getTodayString()}.md`);
  }

  function exportAll() {
    exportTweets(allTweets, `scroll-curator-all-${getTodayString()}.md`);
  }

  // ===== CLEAR ALL =====

  async function clearAll() {
    try {
      const allData = await chrome.storage.local.get(null);
      const keysToRemove = Object.keys(allData).filter(k => 
        k.startsWith('sc_tweets_')
      );
      
      if (keysToRemove.length > 0) {
        await chrome.storage.local.remove(keysToRemove);
      }
      
      allTweets = [];
      applyFilters();
      hideModal();
      
      chrome.runtime.sendMessage({ action: 'refreshCount' });
      showToast('All data cleared', 'success');
    } catch (e) {
      showToast('Error clearing data', 'error');
    }
  }

  // ===== NAVIGATION =====

  function showSettings() {
    els.mainPage.classList.remove('active');
    els.settingsPage.classList.add('active');
    renderSettings();
  }

  function showMain() {
    els.settingsPage.classList.remove('active');
    els.mainPage.classList.add('active');
  }

  function renderSettings() {
    if (storageUsage) {
      const percent = Math.min(parseFloat(storageUsage.percentUsed), 100);
      els.storageFill.style.width = percent + '%';
      els.storageFill.classList.remove('warning', 'danger');
      if (percent >= 90) els.storageFill.classList.add('danger');
      else if (percent >= 70) els.storageFill.classList.add('warning');
      
      els.storageText.textContent = `${formatBytes(storageUsage.totalBytes)} / ${formatBytes(storageUsage.maxBytes)}`;
    }
    
    els.thresholdSlider.value = settings.threshold || 5000;
    els.thresholdDisplay.textContent = formatNum(settings.threshold || 5000);
  }

  function showToast(message, type = 'success') {
    els.toast.textContent = message;
    els.toast.className = 'toast ' + type;
    setTimeout(() => els.toast.classList.add('hidden'), 2500);
  }

  function hideModal() {
    els.confirmModal.classList.add('hidden');
  }

  // ===== EVENT LISTENERS =====

  function setupEventListeners() {
    // Navigation
    els.settingsBtn.onclick = showSettings;
    els.backBtn.onclick = showMain;
    
    // Search
    els.searchInput.oninput = (e) => {
      filters.search = e.target.value;
      applyFilters();
    };
    
    // Filter toggle
    els.filterToggle.onclick = () => {
      els.filterPanel.classList.toggle('hidden');
      els.filterToggle.classList.toggle('active');
    };
    
    // Date filter buttons
    els.dateBtns.forEach(btn => {
      btn.onclick = () => {
        els.dateBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        filters.dateRange = btn.dataset.days;
        
        if (filters.dateRange === 'custom') {
          els.customDate.classList.remove('hidden');
        } else {
          els.customDate.classList.add('hidden');
          filters.dateFrom = null;
          filters.dateTo = null;
        }
        
        applyFilters();
      };
    });
    
    // Custom date inputs
    els.dateFrom.onchange = (e) => {
      filters.dateFrom = e.target.value;
      applyFilters();
    };
    
    els.dateTo.onchange = (e) => {
      filters.dateTo = e.target.value;
      applyFilters();
    };
    
    // Engagement filter
    els.engagementFilter.onchange = (e) => {
      filters.minEngagement = parseInt(e.target.value);
      applyFilters();
    };
    
    // Clear filters
    els.clearFilters.onclick = () => {
      filters = {
        search: '',
        dateRange: 'all',
        dateFrom: null,
        dateTo: null,
        minEngagement: 0
      };
      
      els.searchInput.value = '';
      els.dateBtns.forEach(b => b.classList.remove('active'));
      document.querySelector('[data-days="all"]').classList.add('active');
      els.customDate.classList.add('hidden');
      els.dateFrom.value = '';
      els.dateTo.value = '';
      els.engagementFilter.value = '0';
      
      applyFilters();
    };
    
    // Settings
    els.thresholdSlider.oninput = (e) => {
      const val = parseInt(e.target.value);
      settings.threshold = val;
      els.thresholdDisplay.textContent = formatNum(val);
      saveSettings();
    };
    
    els.exportTodayBtn.onclick = exportToday;
    els.exportAllBtn.onclick = exportAll;
    
    els.clearAllBtn.onclick = () => els.confirmModal.classList.remove('hidden');
    els.cancelClear.onclick = hideModal;
    els.confirmClear.onclick = clearAll;
    
    els.confirmModal.onclick = (e) => {
      if (e.target === els.confirmModal) hideModal();
    };
  }

  // Start
  document.addEventListener('DOMContentLoaded', init);
})();
