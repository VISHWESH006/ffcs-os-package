/**
 * FFCS OS — Popup Lifecycle & State Management (v1.5.0)
 * Uses chrome.storage.local key: ffcs_bulk_session
 * Relies on FFCSCore (extractor-core.js) for business logic.
 */
'use strict';

document.addEventListener('DOMContentLoaded', () => {
  const STORAGE_KEY = 'ffcs_bulk_session';

  // Elements
  const statCourses = document.getElementById('stat-courses');
  const statOfferings = document.getElementById('stat-offerings');
  const statAttempts = document.getElementById('stat-attempts');
  const statMatches = document.getElementById('stat-matches');
  const statusBadge = document.getElementById('vtop-status-badge');
  const alertBox = document.getElementById('alert-box');
  const alertText = document.getElementById('alert-text');

  const btnImport = document.getElementById('btn-import');
  const btnCheckPage = document.getElementById('btn-check-page');
  const btnExport = document.getElementById('btn-export');
  const btnCopyJson = document.getElementById('btn-copy-json');
  const btnNewSession = document.getElementById('btn-new-session');
  const btnClearSession = document.getElementById('btn-clear-session');
  const btnRetryStorage = document.getElementById('btn-retry-storage');

  const historyCount = document.getElementById('history-count');
  const historyList = document.getElementById('history-list');
  const historyArrow = document.getElementById('history-arrow');
  const toggleHistory = document.getElementById('toggle-history');

  const coursesCount = document.getElementById('courses-count');
  const coursesList = document.getElementById('courses-list');
  const coursesArrow = document.getElementById('courses-arrow');
  const toggleCourses = document.getElementById('toggle-courses');

  const matchesCount = document.getElementById('matches-count');
  const matchesList = document.getElementById('matches-list');
  const matchesArrow = document.getElementById('matches-arrow');
  const toggleMatches = document.getElementById('toggle-matches');

  const confirmModal = document.getElementById('confirm-modal');
  const modalTitle = document.getElementById('modal-title');
  const modalText = document.getElementById('modal-text');
  const modalCancel = document.getElementById('modal-cancel');
  const modalConfirm = document.getElementById('modal-confirm');

  let currentSession = null;
  let activeTabId = null;
  let modalCallback = null;
  let storageWritable = false;
  let storageDirty = false;

  // ─── Alert Helpers ────────────────────────────────────────────────────────

  function showAlert(text, type = 'info') {
    alertBox.className = `alert alert-${type}`;
    alertText.textContent = text;
  }

  // ─── Modal Dialog Helper ──────────────────────────────────────────────────

  function showConfirm(title, message, onConfirm) {
    modalTitle.textContent = title;
    modalText.textContent = message;
    modalCallback = onConfirm;
    confirmModal.classList.remove('hidden');
  }

  modalCancel.addEventListener('click', () => {
    confirmModal.classList.add('hidden');
    modalCallback = null;
  });

  modalConfirm.addEventListener('click', () => {
    confirmModal.classList.add('hidden');
    if (modalCallback) {
      modalCallback();
      modalCallback = null;
    }
  });

  // ─── Session & Storage ────────────────────────────────────────────────────

  function loadSession(callback) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        chrome.storage.local.get([STORAGE_KEY], (res) => {
          const storageError = chrome.runtime.lastError;
          if (storageError) {
            currentSession = null;
            storageWritable = false;
            btnImport.disabled = true;
            btnNewSession.disabled = true;
            btnClearSession.disabled = true;
            btnRetryStorage.classList.remove('hidden');
            statusBadge.textContent = 'Storage Error';
            showAlert(`Could not read the saved collection: ${storageError.message}. No empty session was created. Retry storage access before importing.`, 'error');
            return;
          }
          currentSession = res && res[STORAGE_KEY] && res[STORAGE_KEY].courses
            ? res[STORAGE_KEY]
            : window.FFCSCore.createNewSession();
          storageWritable = true;
          storageDirty = false;
          btnNewSession.disabled = false;
          btnClearSession.disabled = false;
          btnImport.disabled = false;
          btnRetryStorage.classList.add('hidden');
          updateUI();
          if (callback) callback();
        });
      } catch (error) {
        currentSession = null;
        storageWritable = false;
        btnImport.disabled = true;
        btnNewSession.disabled = true;
        btnClearSession.disabled = true;
        btnRetryStorage.classList.remove('hidden');
        statusBadge.textContent = 'Storage Error';
        showAlert(`Could not read the saved collection: ${error.message}. No empty session was created. Retry storage access before importing.`, 'error');
      }
    } else {
      currentSession = window.FFCSCore.createNewSession();
      storageWritable = false;
      btnImport.disabled = true;
      btnNewSession.disabled = true;
      btnClearSession.disabled = true;
      btnRetryStorage.classList.remove('hidden');
      showAlert('Browser storage is unavailable. The extension cannot safely save a collection; restore storage access before importing.', 'error');
      updateUI();
    }
  }

  function saveSession(callback, failureMessage = 'The import was not saved. Keep this popup open and export a copy or retry storage access before closing.') {
    if (!currentSession) return;
    storageDirty = true;
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        chrome.storage.local.set({ [STORAGE_KEY]: currentSession }, () => {
          const storageError = chrome.runtime.lastError;
          if (storageError) {
            storageWritable = false;
            btnImport.disabled = true;
            btnNewSession.disabled = true;
            btnClearSession.disabled = true;
            btnRetryStorage.classList.remove('hidden');
            updateUI();
            showAlert(`Storage error: ${storageError.message}. ${failureMessage}`, 'error');
          } else {
            storageWritable = true;
            storageDirty = false;
            btnNewSession.disabled = false;
            btnClearSession.disabled = false;
            btnImport.disabled = false;
            btnRetryStorage.classList.add('hidden');
            updateUI();
            if (callback) callback();
          }
        });
      } catch (error) {
        storageWritable = false;
        btnImport.disabled = true;
        btnNewSession.disabled = true;
        btnClearSession.disabled = true;
        btnRetryStorage.classList.remove('hidden');
        updateUI();
        showAlert(`Storage error: ${error.message}. ${failureMessage}`, 'error');
      }
    } else {
      storageWritable = false;
      btnRetryStorage.classList.remove('hidden');
      updateUI();
      showAlert(`Browser storage is unavailable. ${failureMessage}`, 'error');
    }
  }

  btnRetryStorage.addEventListener('click', () => {
    btnRetryStorage.disabled = true;
    if (storageDirty && currentSession) {
      saveSession(() => showAlert('Collection saved to browser storage.', 'success'));
    } else {
      loadSession(() => checkActiveTab());
    }
    setTimeout(() => { btnRetryStorage.disabled = false; }, 0);
  });

  // ─── UI Rendering ─────────────────────────────────────────────────────────

  function updateUI() {
    if (!currentSession) return;

    const courseArray = Object.values(currentSession.courses || {});
    const totalCourses = courseArray.length;
    const totalOfferings = courseArray.reduce((sum, c) => sum + (c.options ? c.options.length : 0), 0);
    const totalAttempts = (currentSession.pageHistory || []).length;
    const matchArray = currentSession.possibleMatches || [];
    const totalMatches = matchArray.length;

    statCourses.textContent = String(totalCourses);
    statOfferings.textContent = String(totalOfferings);
    statAttempts.textContent = String(totalAttempts);
    if (statMatches) statMatches.textContent = String(totalMatches);

    coursesCount.textContent = String(totalCourses);
    historyCount.textContent = String(totalAttempts);
    if (matchesCount) matchesCount.textContent = String(totalMatches);

    // Export button states
    const hasData = totalOfferings > 0;
    btnExport.disabled = !hasData;
    btnCopyJson.disabled = !hasData;

    // Render Page History
    if (totalAttempts === 0) {
      historyList.innerHTML = '<div style="color:#71717a; text-align:center; padding: 10px 0;">No pages imported yet.</div>';
    } else {
      historyList.innerHTML = currentSession.pageHistory.slice().reverse().map(h => {
        const timeStr = new Date(h.importedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const m = h.metrics || {};
        return `
          <div class="history-item">
            <div>
              <div class="history-title">#${h.attemptIndex} ${escapeHtml(h.category || h.pageTitle)}</div>
              <div style="font-size:10px; color:#71717a;">${timeStr} · ${m.rowsScanned || 0} scanned</div>
            </div>
            <div class="history-metrics">
              +${m.offeringsAdded || 0} add · ${m.offeringsUpdated || 0} upd
            </div>
          </div>
        `;
      }).join('');
    }

    // Render Captured Courses
    if (totalCourses === 0) {
      coursesList.innerHTML = '<div style="color:#71717a; text-align:center; padding: 10px 0;">No courses captured yet.</div>';
    } else {
      coursesList.innerHTML = courseArray.map(c => {
        return `
          <div class="course-item">
            <span class="course-code">${escapeHtml(c.courseCode)}</span>
            <span class="course-name" title="${escapeHtml(c.courseName || '')}">${escapeHtml(c.courseName || 'Untitled')}</span>
            <span class="course-opts">${c.options ? c.options.length : 0} opt</span>
          </div>
        `;
      }).join('');
    }

    // Render Divergent Matches
    if (matchesList) {
      if (totalMatches === 0) {
        matchesList.innerHTML = '<div style="color:#71717a; text-align:center; padding: 10px 0;">No divergent matches detected.</div>';
      } else {
        matchesList.innerHTML = matchArray.map(m => {
          const ex = m.existingOffering || {};
          const inc = m.incomingOffering || {};
          return `
            <div class="history-item" style="flex-direction: column; align-items: flex-start; gap: 4px;">
              <div style="display:flex; justify-content:space-between; width:100%;">
                <span style="font-weight:700; color:#f59e0b;">${escapeHtml(m.courseCode)} [${(m.slots || []).join('+')}]</span>
                <span style="font-size:9px; color:#a1a1aa;">${escapeHtml(m.componentType || 'Unknown component')}</span>
              </div>
              <div style="font-size:10px; color:#d4d4d8;">
                Option 1: ${escapeHtml(ex.facultyName || 'No faculty')} (${escapeHtml(ex.venue || 'No venue')})
              </div>
              <div style="font-size:10px; color:#d4d4d8;">
                Option 2: ${escapeHtml(inc.facultyName || 'No faculty')} (${escapeHtml(inc.venue || 'No venue')})
              </div>
            </div>
          `;
        }).join('');
      }
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ─── Tab Status Check ─────────────────────────────────────────────────────

  function checkActiveTab() {
    btnImport.disabled = true;
    if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.tabs.query) {
      statusBadge.textContent = 'Demo Mode';
      showAlert('Browser tab access is unavailable. Open this popup in Chrome to check the current page.', 'error');
      return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab || !tab.id) {
        statusBadge.textContent = 'No Tab';
        btnImport.disabled = true;
        showAlert('No active browser tab is available. Open the VTOP registration page and check again.', 'warning');
        return;
      }

      activeTabId = tab.id;
      let activeUrl;
      try {
        activeUrl = new URL(tab.url || '');
      } catch {
        activeUrl = null;
      }
      const isDemoHost = activeUrl?.protocol === 'https:' && activeUrl.hostname === 'ffcs-demo.vercel.app';
      const isVtopHost = activeUrl?.protocol === 'https:' && activeUrl.hostname === 'vtop.vitbhopal.ac.in';
      const isDevVtopHost = activeUrl?.protocol === 'https:' && activeUrl.hostname === 'dev.vitbhopal.ac.in';
      if (!isVtopHost && !isDemoHost && !isDevVtopHost) {
        statusBadge.textContent = 'Non-VTOP';
        statusBadge.style.background = '#450a0a';
        btnImport.disabled = true;
        showAlert('Please open VTOP Bhopal (Academics → Course Registration).', 'warning');
        return;
      }

      if (isDemoHost) {
        showAlert('Demo test host recognized. Checking the rendered course table...', 'info');
      }
      if (isDevVtopHost) {
        showAlert('VIT Bhopal development host recognized. Checking the rendered registration tables...', 'info');
      }

      // Tab is on VTOP Bhopal; query content script
      chrome.tabs.sendMessage(activeTabId, { action: 'CHECK_PAGE_STATUS' }, (res) => {
        if (chrome.runtime.lastError || !res) {
          statusBadge.textContent = 'Not Ready';
          statusBadge.style.background = '#451a03';
          showAlert('Please refresh the VTOP tab and reopen the extension.', 'warning');
          return;
        }

        if (res.hasRegistrationTable) {
          statusBadge.textContent = 'Table Found';
          statusBadge.style.background = '#064e3b';
          btnImport.disabled = false;
          const catInfo = res.detectedCategory ? ` (${res.detectedCategory})` : '';
          showAlert(`Ready to import Course Registration table${catInfo}.`, 'info');
        } else {
          statusBadge.textContent = 'No Tables';
          statusBadge.style.background = '#451a03';
          showAlert('On an approved test page, but no supported offering table was detected. Make sure registration details are loaded.', 'warning');
        }
      });
    });
  }

  btnCheckPage.addEventListener('click', checkActiveTab);

  // ─── Actions ─────────────────────────────────────────────────────────────

  // 1. Import This Page
  btnImport.addEventListener('click', () => {
    if (!activeTabId) return;

    btnImport.disabled = true;
    showAlert('Extracting course options from page...', 'info');

    chrome.tabs.sendMessage(activeTabId, { action: 'EXTRACT_PAGE_DATA' }, (response) => {
      btnImport.disabled = false;

      if (chrome.runtime.lastError || !response) {
        showAlert('Communication failed. Refresh the VTOP tab and try again.', 'error');
        return;
      }

      if (!response.success) {
        showAlert(response.error || 'Extraction failed on this page.', 'error');
        return;
      }

      const { sanitizedUrl, rawUrl, pageTitle, detectedCategory, rows, domMetrics } = response;

      const mergeResult = window.FFCSCore.mergePageImport(
        currentSession,
        { sanitizedUrl, rawUrl, pageTitle, detectedCategory, domMetrics },
        rows
      );

      saveSession(() => {
        const m = mergeResult.attemptRecord.metrics;
        let msg = `✓ Successfully imported ${m.offeringsExtracted} offerings (${m.offeringsAdded} added, ${m.offeringsUpdated} updated).`;
        if (mergeResult.possibleMatches && mergeResult.possibleMatches.length > 0) {
          msg += ` ${mergeResult.possibleMatches.length} divergent offering(s) preserved separately.`;
        }
        showAlert(msg, 'success');
      });
    });
  });

  // 2. Finish & Export
  btnExport.addEventListener('click', () => {
    if (!currentSession) return;

    const payload = window.FFCSCore.buildExportPayload(currentSession, '1.1.0');
    const jsonStr = JSON.stringify(payload, null, 2);

    // 1. Download file
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    const dateStr = new Date().toISOString().replace(/[-:T.]/g, '').substring(0, 14);
    const filename = `ffcs_vtop_import_${dateStr}.json`;

    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);

    // 2. Also copy to clipboard
    navigator.clipboard.writeText(jsonStr).then(() => {
      showAlert(`✓ Exported ${filename} & copied JSON to clipboard!`, 'success');
    }).catch(() => {
      showAlert(`✓ Exported ${filename}!`, 'success');
    });
  });

  // 3. Copy JSON
  btnCopyJson.addEventListener('click', () => {
    if (!currentSession) return;

    const payload = window.FFCSCore.buildExportPayload(currentSession, '1.1.0');
    const jsonStr = JSON.stringify(payload, null, 2);

    navigator.clipboard.writeText(jsonStr).then(() => {
      showAlert('✓ Consolidated JSON copied to clipboard!', 'success');
    }).catch(err => {
      showAlert('Failed to copy to clipboard: ' + err, 'error');
    });
  });

  // 4. Start New Session
  btnNewSession.addEventListener('click', () => {
    if (!storageWritable) return;
    const courseCount = Object.keys(currentSession.courses || {}).length;
    if (courseCount > 0) {
      showConfirm(
        'Start New Session?',
        `You currently have ${courseCount} courses collected. Starting a new session will discard this unexported data. Continue?`,
        () => {
          currentSession = window.FFCSCore.createNewSession();
          saveSession(() => showAlert('Started a fresh collection session.', 'info'), 'The new session is only in this popup. The previously saved collection remains in storage; keep this popup open and retry, or reopen it to restore the saved collection.');
        }
      );
    } else {
      currentSession = window.FFCSCore.createNewSession();
      saveSession(() => showAlert('Started a fresh collection session.', 'info'), 'The new session is only in this popup. The previously saved collection remains in storage; keep this popup open and retry, or reopen it to restore the saved collection.');
    }
  });

  // 5. Clear / Reset All
  btnClearSession.addEventListener('click', () => {
    if (!storageWritable) return;
    const courseCount = Object.keys(currentSession.courses || {}).length;
    showConfirm(
      'Reset All Data?',
      `Are you sure you want to completely clear the current collection (${courseCount} courses)? This cannot be undone.`,
      () => {
        currentSession = window.FFCSCore.createNewSession();
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          try {
            chrome.storage.local.remove([STORAGE_KEY], () => {
              const storageError = chrome.runtime.lastError;
              if (storageError) {
                storageWritable = false;
                btnImport.disabled = true;
                btnNewSession.disabled = true;
                btnClearSession.disabled = true;
                btnRetryStorage.classList.remove('hidden');
                showAlert(`Could not clear saved data: ${storageError.message}. The stored collection was not confirmed deleted; keep this popup open and retry.`, 'error');
                return;
              }
              storageDirty = false;
              storageWritable = true;
              updateUI();
              showAlert('Collection cleared.', 'info');
            });
          } catch (error) {
            showAlert(`Could not clear saved data: ${error.message}. The stored collection was not confirmed deleted.`, 'error');
          }
        } else {
          showAlert('Browser storage is unavailable. The collection was not cleared from saved storage.', 'error');
        }
      }
    );
  });

  // ─── Collapsible Toggles ──────────────────────────────────────────────────

  toggleHistory.addEventListener('click', () => {
    historyList.classList.toggle('hidden');
    historyArrow.textContent = historyList.classList.contains('hidden') ? '▸' : '▾';
  });

  toggleCourses.addEventListener('click', () => {
    coursesList.classList.toggle('hidden');
    coursesArrow.textContent = coursesList.classList.contains('hidden') ? '▸' : '▾';
  });

  if (toggleMatches && matchesList) {
    toggleMatches.addEventListener('click', () => {
      matchesList.classList.toggle('hidden');
      if (matchesArrow) {
        matchesArrow.textContent = matchesList.classList.contains('hidden') ? '▸' : '▾';
      }
    });
  }

  // ─── Initialize ──────────────────────────────────────────────────────────

  loadSession(() => {
    checkActiveTab();
  });
});

