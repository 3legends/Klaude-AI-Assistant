document.addEventListener('DOMContentLoaded', () => {

    // ── DOM refs ─────────────────────────────────────────────────────────────
    const closeButton          = document.getElementById('closeButton');
    const quitButton           = document.getElementById('quitButton');
    const geminiKeyInput       = document.getElementById('geminiKey');
    const saveGeminiKeyBtn     = document.getElementById('saveGeminiKey');
    const testConnectionBtn    = document.getElementById('testGeminiConnection');
    const testConnectionResult = document.getElementById('testConnectionResult');
    const geminiKeyStatus      = document.getElementById('geminiKeyStatus');
    const geminiKeyStatusText  = document.getElementById('geminiKeyStatusText');
    const windowGapInput       = document.getElementById('windowGap');
    const codingLanguageSelect = document.getElementById('codingLanguage');
    const activeSkillSelect    = document.getElementById('activeSkill');
    const iconGrid             = document.getElementById('iconGrid');

    if (!window.api) {
        console.error('window.api not available');
        return;
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    function showKeyBadge(saved) {
        if (!geminiKeyStatus) return;
        geminiKeyStatus.style.display = saved ? 'flex' : 'none';
        if (geminiKeyStatusText) geminiKeyStatusText.textContent = 'API key saved';
    }

    function setTestResult(state, message) {
        if (!testConnectionResult) return;
        testConnectionResult.style.display = 'inline';
        const colours = {
            success: '#4ade80',
            error:   '#f87171',
            loading: '#888',
        };
        testConnectionResult.style.color = colours[state] || '#888';
        testConnectionResult.textContent = message;
    }

    // ── Load settings into UI ─────────────────────────────────────────────────
    const loadSettingsIntoUI = (settings) => {
        if (!settings) return;

        if (settings.windowGap      && windowGapInput)       windowGapInput.value       = settings.windowGap;
        if (settings.codingLanguage && codingLanguageSelect) codingLanguageSelect.value = settings.codingLanguage;
        if (settings.activeSkill    && activeSkillSelect)    activeSkillSelect.value    = settings.activeSkill;

        // API key: never shown in plain text — just show/hide badge
        showKeyBadge(!!settings.hasGeminiKey);

        // Icon selection
        const selectedIcon = settings.selectedIcon || settings.appIcon;
        if (selectedIcon && iconGrid) {
            iconGrid.querySelectorAll('.icon-option').forEach(opt => {
                opt.classList.toggle('selected', opt.dataset.icon === selectedIcon);
            });
        }
    };

    const requestCurrentSettings = () => {
        if (window.electronAPI && window.electronAPI.getSettings) {
            window.electronAPI.getSettings()
                .then(loadSettingsIntoUI)
                .catch(err => console.error('Failed to get settings:', err));
        }
    };

    // ── Save general preferences ──────────────────────────────────────────────
    const saveSettings = () => {
        const settings = {};
        if (windowGapInput)       settings.windowGap      = windowGapInput.value;
        if (codingLanguageSelect) settings.codingLanguage = codingLanguageSelect.value;
        if (activeSkillSelect)    settings.activeSkill    = activeSkillSelect.value;
        window.api.send('save-settings', settings);
    };

    // ── Save Gemini API key ───────────────────────────────────────────────────
    if (saveGeminiKeyBtn) {
        saveGeminiKeyBtn.addEventListener('click', async () => {
            const key = geminiKeyInput ? geminiKeyInput.value.trim() : '';
            if (!key) return;

            saveGeminiKeyBtn.disabled    = true;
            saveGeminiKeyBtn.textContent = 'Saving...';

            try {
                if (window.electronAPI && window.electronAPI.setGeminiApiKey) {
                    await window.electronAPI.setGeminiApiKey(key);
                } else {
                    window.api.send('save-settings', { geminiKey: key });
                }
                geminiKeyInput.value = '';
                showKeyBadge(true);
                setTestResult('success', '✓ Key saved');
                setTimeout(() => { testConnectionResult.style.display = 'none'; }, 2500);
            } catch (err) {
                setTestResult('error', '✗ Failed to save key');
                console.error('Failed to save Gemini key:', err);
            } finally {
                saveGeminiKeyBtn.disabled    = false;
                saveGeminiKeyBtn.textContent = 'Save key';
            }
        });
    }

    // Enter in key field triggers Save
    if (geminiKeyInput) {
        geminiKeyInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && saveGeminiKeyBtn) saveGeminiKeyBtn.click();
        });
    }

    // ── Test connection ───────────────────────────────────────────────────────
    if (testConnectionBtn) {
        testConnectionBtn.addEventListener('click', async () => {
            testConnectionBtn.disabled = true;
            setTestResult('loading', 'Testing...');

            try {
                let result;
                if (window.electronAPI && window.electronAPI.testGeminiConnection) {
                    result = await window.electronAPI.testGeminiConnection();
                }

                if (result && result.success) {
                    setTestResult('success', '✓ Connection successful');
                } else {
                    const msg = (result && result.error) ? result.error : 'Connection failed';
                    setTestResult('error', '✗ ' + msg);
                }
            } catch (err) {
                setTestResult('error', '✗ ' + (err.message || 'Unknown error'));
            } finally {
                testConnectionBtn.disabled = false;
            }
        });
    }

    // ── General preference listeners ──────────────────────────────────────────
    if (windowGapInput) {
        windowGapInput.addEventListener('change', saveSettings);
        windowGapInput.addEventListener('blur',   saveSettings);
    }

    if (codingLanguageSelect) codingLanguageSelect.addEventListener('change', saveSettings);

    if (activeSkillSelect) {
        activeSkillSelect.addEventListener('change', (e) => {
            saveSettings();
            window.api.send('update-skill', e.target.value);
        });
    }

    // ── IPC listeners ─────────────────────────────────────────────────────────
    window.api.receive('load-settings', loadSettingsIntoUI);

    if (window.electronAPI && window.electronAPI.receive) {
        window.electronAPI.receive('settings-window-shown', requestCurrentSettings);
    }

    // ── Close / Quit ──────────────────────────────────────────────────────────
    if (closeButton) {
        closeButton.addEventListener('click', () => window.api.send('close-settings'));
    }

    if (quitButton) {
        quitButton.addEventListener('click', () => {
            try {
                if (window.api && window.api.send)                 window.api.send('quit-app');
                if (window.electronAPI && window.electronAPI.quit) window.electronAPI.quit();
                setTimeout(() => window.close(), 500);
            } catch (err) {
                window.close();
            }
        });
    }

    // ── Icon grid ─────────────────────────────────────────────────────────────
    const initializeIconGrid = () => {
        if (!iconGrid) return;

        const icons = [
            { key: 'terminal', name: 'Terminal', src: './assests/icons/terminal.png' },
            { key: 'activity', name: 'Activity',  src: './assests/icons/activity.png' },
            { key: 'settings', name: 'Settings',  src: './assests/icons/settings.png' },
        ];

        iconGrid.innerHTML = '';

        icons.forEach(icon => {
            const el        = document.createElement('div');
            el.className    = 'icon-option';
            el.dataset.icon = icon.key;

            const img   = document.createElement('img');
            img.src     = icon.src;
            img.alt     = icon.name;
            img.onerror = () => {
                const alts = [`./assests/${icon.key}.png`, `./assets/icons/${icon.key}.png`];
                let i = 0;
                const tryNext = () => {
                    if (i < alts.length) { img.src = alts[i++]; } else { img.style.display = 'none'; }
                };
                img.onerror = tryNext;
                tryNext();
            };

            const label       = document.createElement('div');
            label.textContent = icon.name;

            el.appendChild(img);
            el.appendChild(label);

            el.addEventListener('click', () => {
                iconGrid.querySelectorAll('.icon-option').forEach(o => o.classList.remove('selected'));
                el.classList.add('selected');
                window.api.send('save-settings', { selectedIcon: icon.key });
                el.style.transform = 'scale(0.95)';
                setTimeout(() => { el.style.transform = 'scale(1)'; }, 100);
            });

            iconGrid.appendChild(el);
        });
    };

    initializeIconGrid();

    // ── ESC to close ──────────────────────────────────────────────────────────
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') window.api.send('close-settings');
    });

    // Initial load
    setTimeout(requestCurrentSettings, 200);
});