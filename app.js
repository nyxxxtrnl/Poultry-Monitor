(() => {
  'use strict';

  const DEFAULT_DEVICE_URL = 'http://192.168.4.1';
  const FIREBASE_CONFIG = window.POULTRY_FIREBASE_CONFIG &&
      typeof window.POULTRY_FIREBASE_CONFIG === 'object'
    ? window.POULTRY_FIREBASE_CONFIG
    : null;
  const FIREBASE_DATABASE_URL = typeof FIREBASE_CONFIG?.databaseURL === 'string'
    ? FIREBASE_CONFIG.databaseURL.trim().replace(/\/+$/, '')
    : '';
  const IS_FIREBASE_CLOUD_PAGE =
    window.location.protocol === 'https:' && Boolean(FIREBASE_DATABASE_URL);
  const STORAGE_KEY = 'poultry-monitor-device-url';
  const THEME_STORAGE_KEY = 'poultry-monitor-theme';
  const REFRESH_INTERVAL_MS = 3000;
  const REQUEST_TIMEOUT_MS = 5000;
  const DATA_STALE_MS = 10000;
  const WAITING_FOR_READING_MESSAGE = 'Waiting for the first ESP32 reading.';
  const MAX_CHART_RECORDS = 12;
  const BLE_SERVICE_UUID = 'a3c87500-8ed3-4bdf-8a39-a01bebede295';
  const BLE_STATUS_CHARACTERISTIC_UUID = 'a3c87501-8ed3-4bdf-8a39-a01bebede295';
  const BLE_HISTORY_CHARACTERISTIC_UUID = 'a3c87502-8ed3-4bdf-8a39-a01bebede295';

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const elements = {
    banner: $('#connection-banner'),
    connectionTitle: $('#connection-title'),
    connectionMessage: $('#connection-message'),
    connectionState: $('#connection-state'),
    stopWarningButton: $('#stop-warning-button'),
    warningActionMessage: $('#warning-action-message'),
    diagnosticAttempt: $('#diagnostic-attempt'),
    diagnosticStatusApi: $('#diagnostic-status-api'),
    diagnosticHistoryApi: $('#diagnostic-history-api'),
    diagnosticLastReading: $('#diagnostic-last-reading'),
    diagnosticErrorRow: $('#diagnostic-error-row'),
    diagnosticError: $('#diagnostic-error'),
    sidebarStatus: $('#sidebar-status'),
    sidebarAddress: $('#sidebar-address'),
    deviceAddressLabel: $('#device-address-label'),
    updatedLabel: $('#updated-label'),
    climateUpdatedLabel: $('#climate-updated-label'),
    temperatureValue: $('#temperature-value'),
    humidityValue: $('#humidity-value'),
    climateTemperatureValue: $('#climate-temperature-value'),
    climateHumidityValue: $('#climate-humidity-value'),
    temperatureCondition: $('#temperature-condition'),
    humidityCondition: $('#humidity-condition'),
    climateTemperatureCondition: $('#climate-temperature-condition'),
    climateHumidityCondition: $('#climate-humidity-condition'),
    temperatureMeter: $('#temperature-meter'),
    humidityMeter: $('#humidity-meter'),
    sensorHealthIcon: $('#sensor-health-icon'),
    sensorHealthPill: $('#sensor-health-pill'),
    deviceHealthPill: $('#device-health-pill'),
    recentList: $('#recent-list'),
    historyList: $('#history-list'),
    historyChart: $('#history-chart'),
    recordCount: $('#record-count'),
    deviceUrlInput: $('#device-url'),
    settingsForm: $('#settings-form'),
    settingsMessage: $('#settings-message'),
    darkModeToggle: $('#dark-mode-toggle'),
    themeModeLabel: $('#theme-mode-label'),
    themeMessage: $('#theme-message'),
    installButton: $('#install-button'),
    installMessage: $('#install-message'),
    saveButton: $('#save-button'),
    refreshButton: $('#refresh-button'),
    bluetoothConnectButton: $('#bluetooth-connect-button'),
    pageTitle: $('#page-title'),
    headingSection: $('#heading-section'),
    statusDots: $$('.status-dot'),
  };

  const pageInfo = {
    home: { title: 'Good day, caretaker <span class="wave">✳</span>', section: 'OVERVIEW' },
    climate: { title: 'House climate', section: 'CLIMATE' },
    history: { title: 'Sensor history', section: 'HISTORY' },
    settings: { title: 'Monitor settings', section: 'PREFERENCES' },
  };

  const state = {
    deviceUrl: getSavedDeviceUrl(),
    connected: false,
    sensorOK: false,
    warning: '',
    activeWarningKey: '',
    warningSilenced: false,
    stoppingWarning: false,
    warningActionMessage: '',
    temperature: null,
    humidity: null,
    history: [],
    lastUpdated: null,
    lastAttemptAt: null,
    statusApiState: 'waiting',
    historyApiState: 'waiting',
    lastError: '',
    refreshing: false,
    refreshQueued: false,
    timer: null,
    bluetoothDevice: null,
    bluetoothCharacteristic: null,
    bluetoothHistoryCharacteristic: null,
    connectionType: 'network',
    firebaseStatusSource: null,
    firebaseHistorySource: null,
    firebaseListenersStarted: false,
    firebaseCurrentStatus: null,
    firebaseHistoryRecords: new Map(),
    bluetoothReadyForReconnect: false,
  };

  let deferredInstallPrompt = null;

  function getSavedDeviceUrl() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved && isValidDeviceUrl(saved) ? normalizeUrl(saved) : getDefaultDeviceUrl();
    } catch (error) {
      console.warn('Could not read the saved device address:', error);
      return getDefaultDeviceUrl();
    }
  }

  function getSavedTheme() {
    try {
      return localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark';
    } catch (error) {
      console.warn('Could not read the saved display theme:', error);
      return 'dark';
    }
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    elements.darkModeToggle.checked = theme === 'dark';
    elements.themeModeLabel.textContent = theme === 'dark' ? 'On' : 'Off';
    document.querySelector('meta[name="theme-color"]').content =
      theme === 'dark' ? '#10191b' : '#f0f7f5';
  }

  function isAppInstalled() {
    return window.matchMedia('(display-mode: standalone)').matches ||
      navigator.standalone === true;
  }

  function showInstallMessage(message) {
    elements.installMessage.textContent = message;
  }

  async function installApp() {
    if (isAppInstalled()) {
      showInstallMessage('Coop Care is already installed on this device.');
      return;
    }

    if (!deferredInstallPrompt) {
      const isAppleMobile = /iphone|ipad|ipod/i.test(navigator.userAgent);
      showInstallMessage(isAppleMobile
        ? 'To install on iPhone or iPad, tap Share in Safari, then choose Add to Home Screen.'
        : 'Open your browser menu and choose Install app or Add to Home Screen. Install is available over HTTPS or localhost.');
      return;
    }

    const installPrompt = deferredInstallPrompt;
    deferredInstallPrompt = null;
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      showInstallMessage(choice.outcome === 'accepted'
        ? 'Installing Coop Care…'
        : 'Installation was cancelled. You can install it later from your browser menu.');
    } catch (error) {
      console.error('Could not start app installation:', error);
      showInstallMessage('Could not start installation. Use your browser menu to install the app.');
    }
  }

  function setupProgressiveWebApp() {
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      deferredInstallPrompt = event;
    });
    window.addEventListener('appinstalled', () => {
      deferredInstallPrompt = null;
      showInstallMessage('Coop Care was installed successfully.');
    });

    if ('serviceWorker' in navigator && window.isSecureContext) {
      navigator.serviceWorker.register('./service-worker.js')
        .catch((error) => console.error('Could not register the offline app shell:', error));
    }
  }

  function saveThemePreference() {
    const previousTheme = document.documentElement.dataset.theme || 'dark';
    const selectedTheme = elements.darkModeToggle.checked ? 'dark' : 'light';
    applyTheme(selectedTheme);
    elements.themeMessage.textContent = '';
    elements.themeMessage.className = 'form-message';

    try {
      localStorage.setItem(THEME_STORAGE_KEY, selectedTheme);
    } catch (error) {
      console.error('Could not save the display theme:', error);
      applyTheme(previousTheme);
      elements.themeMessage.textContent = 'Could not save this preference in your browser.';
      elements.themeMessage.className = 'form-message error';
    }
  }

  function getDefaultDeviceUrl() {
    if (window.location.hostname === '192.168.4.1') {
      return window.location.origin;
    }
    return DEFAULT_DEVICE_URL;
  }

  function isValidDeviceUrl(value) {
    try {
      const url = new URL(value.trim());
      return (url.protocol === 'http:' || url.protocol === 'https:') &&
        url.hostname !== '' &&
        url.username === '' &&
        url.password === '' &&
        url.search === '' &&
        url.hash === '' &&
        (url.pathname === '/' || url.pathname === '');
    } catch (_) {
      return false;
    }
  }

  function normalizeUrl(value) {
    return value.trim().replace(/\/+$/, '');
  }

  function showMessage(message, type) {
    elements.settingsMessage.textContent = message;
    elements.settingsMessage.className = `form-message ${type}`;
  }

  function setPage(page) {
    if (!pageInfo[page]) return;

    $$('.page-panel').forEach((panel) => {
      const active = panel.dataset.pagePanel === page;
      panel.hidden = !active;
      panel.classList.toggle('active', active);
    });

    $$('[data-page]').forEach((button) => {
      const active = button.dataset.page === page;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });

    elements.pageTitle.innerHTML = pageInfo[page].title;
    elements.headingSection.textContent = pageInfo[page].section;
    if (window.location.hash !== `#${page}`) {
      history.replaceState(null, '', `#${page}`);
    }
  }

  function formatNumber(value) {
    return Number.isFinite(value) ? value.toFixed(1) : '--.-';
  }

  function formatUptime(milliseconds) {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
      return 'Device uptime unavailable';
    }

    const seconds = Math.floor(milliseconds / 1000);
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    const time = [hours, minutes, remainder].map((part) => String(part).padStart(2, '0')).join(':');
    return days > 0 ? `Uptime ${days}d ${time}` : `Uptime ${time}`;
  }

  function formatHistoryTimestamp(record) {
    if (record.recordedAt) {
      return `Recorded ${new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).format(new Date(record.recordedAt))}`;
    }
    return formatUptime(record.elapsedMs);
  }

  function formatUpdatedAt(date) {
    if (!(date instanceof Date)) return 'Waiting for readings';
    const formatted = new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(date);
    return Date.now() - date.getTime() > DATA_STALE_MS
      ? `Stale · last received ${formatted}`
      : `Updated ${formatted}`;
  }

  function renderDiagnostics() {
    const setApiState = (element, value) => {
      element.textContent = value === 'online' ? 'Reachable' :
        value === 'error' ? 'Error' :
          value === 'checking' ? 'Checking…' :
            value === 'not-available' ? 'Not available in Bluetooth mode' :
            value === 'not-checked' ? 'Not checked' : 'Waiting';
      element.dataset.level = value;
    };

    setApiState(elements.diagnosticStatusApi, state.statusApiState);
    setApiState(elements.diagnosticHistoryApi, state.historyApiState);
    elements.diagnosticAttempt.textContent = state.lastAttemptAt
      ? `Attempted ${new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).format(state.lastAttemptAt)}`
      : 'Not checked yet';
    elements.diagnosticLastReading.textContent = state.lastUpdated
      ? formatUpdatedAt(state.lastUpdated)
      : 'No reading received yet';
    elements.diagnosticErrorRow.hidden = !state.lastError;
    elements.diagnosticError.textContent = state.lastError;
  }

  function getApiRequestUrl(path, baseUrl) {
    if (IS_FIREBASE_CLOUD_PAGE) {
      if (path === '/api/status') {
        return `${FIREBASE_DATABASE_URL}/sensor/latest.json`;
      }
      if (path === '/api/history') {
        const query = new URLSearchParams({
          orderBy: '"recordedAt"',
          limitToLast: '500',
        });
        return `${FIREBASE_DATABASE_URL}/sensor/history.json?${query}`;
      }
      throw new Error('This action is not available from the public cloud dashboard.');
    }

    const isEsp32Dashboard =
      window.location.protocol === 'http:' &&
      window.location.hostname === '192.168.4.1' &&
      normalizeUrl(baseUrl) === normalizeUrl(window.location.origin);
    const isLocalNodeDashboard =
      window.location.protocol === 'http:' &&
      window.location.hostname !== '192.168.4.1';
    return isEsp32Dashboard || isLocalNodeDashboard
      ? path
      : `${baseUrl}${path}`;
  }

  function getHttpsHttpMismatchMessage(baseUrl) {
    if (window.location.protocol === 'https:' && !FIREBASE_DATABASE_URL) {
      return 'Public live readings are not configured yet. Add the Firebase Realtime Database URL to cloud-config.js and connect the ESP32 to internet-capable Wi-Fi.';
    }
    if (window.location.protocol === 'https:' && FIREBASE_DATABASE_URL) {
      try {
        const cloudUrl = new URL(FIREBASE_DATABASE_URL);
        if (cloudUrl.protocol !== 'https:' || cloudUrl.username || cloudUrl.password ||
            cloudUrl.search || cloudUrl.hash) {
          return 'The Firebase Realtime Database URL must be a valid HTTPS URL.';
        }
        return '';
      } catch (_) {
        return 'The Firebase Realtime Database URL in cloud-config.js is invalid.';
      }
    }
    try {
      if (window.location.protocol === 'https:' && new URL(baseUrl).protocol === 'http:') {
        return 'GitHub Pages is served over HTTPS, so browsers block direct requests to the ESP32 local HTTP address. Live readings need a public HTTPS API and ESP32 firmware that sends data to it.';
      }
    } catch (_) {
      return '';
    }
    return '';
  }

  function setCondition(element, label, level) {
    element.textContent = label;
    element.dataset.level = level;
  }

  function renderStatus() {
    const banner = elements.banner;
    const warning = state.warning || (!state.sensorOK
      ? 'The ESP32 reports that the sensor needs attention.'
      : '');
    const isHealthy = state.connected && state.sensorOK && !warning;
    const isWarning = state.connected && Boolean(warning);

    banner.classList.toggle('is-connected', isHealthy);
    banner.classList.toggle('is-warning', isWarning);
    banner.classList.toggle('is-error', !state.connected);

    elements.statusDots.forEach((dot) => {
      dot.classList.remove('connected', 'warning', 'error');
      if (!state.connected) {
        dot.classList.add('error');
      } else if (isWarning) {
        dot.classList.add('warning');
      } else {
        dot.classList.add('connected');
      }
    });

    elements.bluetoothConnectButton.textContent = state.connectionType === 'bluetooth' &&
      state.bluetoothDevice?.gatt?.connected
      ? 'Disconnect Bluetooth'
      : 'Connect ESP32 via Bluetooth';
    elements.bluetoothConnectButton.disabled = !navigator.bluetooth;
    elements.bluetoothConnectButton.title = navigator.bluetooth
      ? 'Connect directly to the ESP32 without Wi-Fi'
      : 'Bluetooth connection requires Android Chrome over HTTPS';
    elements.stopWarningButton.hidden = !state.connected || !warning ||
      state.connectionType === 'bluetooth' ||
      IS_FIREBASE_CLOUD_PAGE;
    elements.stopWarningButton.disabled = state.stoppingWarning || state.warningSilenced;
    elements.stopWarningButton.textContent = state.stoppingWarning
      ? 'Stopping…'
      : state.warningSilenced ? 'Alarm silenced' : 'Stop hardware alarm';
    elements.warningActionMessage.textContent = state.warningActionMessage;

    if (!state.connected) {
      elements.connectionTitle.textContent = 'Monitor is offline';
      elements.connectionMessage.textContent = state.bluetoothReadyForReconnect
        ? 'Bluetooth disconnected. The ESP32 is ready; tap Connect ESP32 via Bluetooth to connect again or choose another device.'
        : 'Tap “Connect ESP32 via Bluetooth” to connect directly without Wi-Fi.';
      elements.connectionState.textContent = 'OFFLINE';
      elements.sidebarStatus.textContent = 'Disconnected';
      elements.deviceHealthPill.textContent = 'OFFLINE';
      elements.deviceHealthPill.className = 'health-pill offline';
      elements.sensorHealthPill.textContent = 'NO DATA';
      elements.sensorHealthPill.className = 'health-pill offline';
      elements.sensorHealthIcon.style.background = 'rgba(var(--danger-rgb), .1)';
      elements.sensorHealthIcon.style.color = 'var(--danger)';
      return;
    }

    elements.sidebarStatus.textContent = warning ? 'Hardware warning' : 'Monitor online';
    elements.deviceHealthPill.textContent = state.sensorOK ? 'ONLINE' : 'CHECK SENSOR';
    elements.deviceHealthPill.className = `health-pill ${state.sensorOK ? 'online' : 'offline'}`;

    if (warning) {
      elements.connectionTitle.textContent = 'Hardware warning';
      elements.connectionMessage.textContent = warning;
      elements.connectionState.textContent = 'WARNING';
      elements.sensorHealthPill.textContent = state.sensorOK ? 'WARNING' : 'CHECK SENSOR';
      elements.sensorHealthPill.className = `health-pill ${state.sensorOK ? 'warning' : 'offline'}`;
      elements.sensorHealthIcon.style.background = 'rgba(var(--warning-rgb), .1)';
      elements.sensorHealthIcon.style.color = 'var(--warning)';
    } else {
      elements.connectionTitle.textContent = state.connectionType === 'bluetooth'
        ? 'Connected to ESP32 via Bluetooth'
        : state.connectionType === 'cloud' ? 'Connected to cloud monitor'
          : 'Your monitor is connected';
      elements.connectionMessage.textContent = state.connectionType === 'bluetooth'
        ? 'Live DHT22 readings are coming directly from the monitor. Cloud history is not available in Bluetooth mode.'
        : state.connectionType === 'cloud'
          ? 'Live readings are streaming from Firebase Realtime Database.'
          : 'The ESP32-S3 is reporting data from the DHT22 sensor.';
      elements.connectionState.textContent = state.connectionType === 'bluetooth'
        ? 'BLUETOOTH'
        : state.connectionType === 'cloud' ? 'CLOUD LIVE'
          : 'ALL SYSTEMS GO';
      elements.sensorHealthPill.textContent = 'HEALTHY';
      elements.sensorHealthPill.className = 'health-pill online';
      elements.sensorHealthIcon.style.background = 'rgba(var(--ok-rgb), .12)';
      elements.sensorHealthIcon.style.color = 'var(--ok)';
    }
  }

  function renderReadings() {
    const temperature = state.temperature;
    const humidity = state.humidity;
    const temperatureLabel = temperature === null ? 'Waiting for data' : `${formatNumber(temperature)} °C`;
    const humidityLabel = humidity === null ? 'Waiting for data' : `${formatNumber(humidity)} %RH`;

    elements.temperatureValue.textContent = formatNumber(temperature);
    elements.humidityValue.textContent = formatNumber(humidity);
    elements.climateTemperatureValue.textContent = formatNumber(temperature);
    elements.climateHumidityValue.textContent = formatNumber(humidity);
    setCondition(elements.temperatureCondition, temperatureLabel, temperature === null ? '' : 'normal');
    setCondition(elements.climateTemperatureCondition, temperatureLabel, temperature === null ? '' : 'normal');
    setCondition(elements.humidityCondition, humidityLabel, humidity === null ? '' : 'normal');
    setCondition(elements.climateHumidityCondition, humidityLabel, humidity === null ? '' : 'normal');
    elements.temperatureMeter.style.width = `${temperature === null ? 0 : Math.max(0, Math.min(100, temperature * 2))}%`;
    elements.humidityMeter.style.width = `${humidity === null ? 0 : Math.max(0, Math.min(100, humidity))}%`;
    elements.updatedLabel.textContent = formatUpdatedAt(state.lastUpdated);
    elements.updatedLabel.parentElement.classList.toggle(
      'is-stale',
      state.lastUpdated instanceof Date && Date.now() - state.lastUpdated.getTime() > DATA_STALE_MS,
    );
    elements.climateUpdatedLabel.textContent = state.lastUpdated
      ? `Latest app reading: ${formatUpdatedAt(state.lastUpdated)}. Values are received from the ESP32.`
      : 'Waiting for the first successful reading';
    renderDiagnostics();
  }

  function makeHistoryEntry(record, index, compact) {
    const container = document.createElement('div');
    container.className = compact ? 'recent-item' : 'history-item';

    const number = document.createElement('span');
    number.className = compact ? 'recent-number' : 'history-index';
    number.textContent = String(index + 1);
    container.append(number);

    const values = document.createElement('div');
    values.className = compact ? 'recent-values' : 'history-reading';
    const temperature = document.createElement('strong');
    temperature.className = 'temp';
    temperature.textContent = `${record.temperature.toFixed(1)} °C`;
    const humidity = document.createElement('strong');
    humidity.className = 'hum';
    humidity.textContent = `${record.humidity.toFixed(1)} %RH`;
    values.append(temperature, humidity);
    container.append(values);

    const time = document.createElement('span');
    time.className = compact ? 'recent-time' : 'history-time';
    time.textContent = formatHistoryTimestamp(record);
    container.append(time);
    return container;
  }

  function validateHistoryRecord(record) {
    if (!record || typeof record !== 'object' ||
        typeof record.temperature !== 'number' || !Number.isFinite(record.temperature) ||
        typeof record.humidity !== 'number' || !Number.isFinite(record.humidity)) {
      throw new Error('The sensor API returned an invalid history record.');
    }
    const recordedAt = typeof record.recordedAt === 'number' ||
          typeof record.recordedAt === 'string'
      ? new Date(record.recordedAt)
      : null;
    return {
      temperature: record.temperature,
      humidity: record.humidity,
      elapsedMs: typeof record.elapsedMs === 'number' && Number.isFinite(record.elapsedMs)
          ? record.elapsedMs
          : null,
      recordedAt: recordedAt && Number.isFinite(recordedAt.getTime())
          ? recordedAt.toISOString()
          : null,
    };
  }

  function renderHistory() {
    elements.recentList.replaceChildren();
    elements.historyList.replaceChildren();

    if (state.history.length === 0) {
      const emptyHistoryMessage = state.connectionType === 'bluetooth'
        ? 'Bluetooth mode shows live readings only; history is not synced.'
        : state.connectionType === 'cloud'
          ? 'Waiting for the first Firebase cloud reading.'
          : 'No readings have been saved to the local SQL database yet.';
      elements.recentList.innerHTML = `<div class="empty-state">${emptyHistoryMessage}</div>`;
      elements.historyList.innerHTML = `<div class="empty-state">${emptyHistoryMessage}</div>`;
      elements.historyChart.innerHTML = `<div class="chart-empty">${emptyHistoryMessage}</div>`;
      elements.recordCount.innerHTML = '0 <small>records</small>';
      return;
    }

    state.history.slice(0, 3).forEach((record, index) => {
      elements.recentList.append(makeHistoryEntry(record, index, true));
    });
    state.history.forEach((record, index) => {
      elements.historyList.append(makeHistoryEntry(record, index, false));
    });
    elements.recordCount.innerHTML = `${state.history.length} <small>${state.history.length === 1 ? 'record' : 'records'}</small>`;
    renderHistoryChart();
  }

  function renderHistoryChart() {
    const records = state.history.slice(0, MAX_CHART_RECORDS).reverse();
    elements.historyChart.replaceChildren();
    if (records.length === 0) return;

    const values = records.map((record) => record.temperature);
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    const range = Math.max(maximum - minimum, 1);

    records.forEach((record, index) => {
      const column = document.createElement('div');
      column.className = 'bar-column';
      const value = document.createElement('strong');
      value.textContent = record.temperature.toFixed(1);
      const bar = document.createElement('span');
      const height = 28 + ((record.temperature - minimum) / range) * 55;
      bar.style.height = `${height}%`;
      bar.setAttribute('aria-label', `${record.temperature.toFixed(1)} degrees Celsius`);
      const label = document.createElement('small');
      label.textContent = `#${index + 1}`;
      column.append(value, bar, label);
      elements.historyChart.append(column);
    });
  }

  async function requestJson(path, baseUrl) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(getApiRequestUrl(path, baseUrl), {
        method: 'GET',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = (await response.text()).trim().slice(0, 180);
        throw new Error(`HTTP ${response.status} for ${path}.${detail ? ` ${detail}` : ''}`);
      }

      let data;
      try {
        data = await response.json();
      } catch (_) {
        throw new Error(`The monitor returned invalid JSON for ${path}.`);
      }

      if (IS_FIREBASE_CLOUD_PAGE && path === '/api/status' && data === null) {
        return {
          temperature: null,
          humidity: null,
          sensorOK: false,
          warning: WAITING_FOR_READING_MESSAGE,
          recordedAt: null,
        };
      }
      if (IS_FIREBASE_CLOUD_PAGE && path === '/api/history') {
        if (data === null) return { history: [] };
        if (!data || typeof data !== 'object') {
          throw new Error('Firebase returned an invalid sensor history response.');
        }
        const history = Object.values(data).map(validateHistoryRecord);
        history.sort((left, right) => {
          const leftTime = left.recordedAt ? Date.parse(left.recordedAt) : 0;
          const rightTime = right.recordedAt ? Date.parse(right.recordedAt) : 0;
          return rightTime - leftTime;
        });
        return { history };
      }
      return data;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function applyFirebaseStatus(status) {
    state.connectionType = 'cloud';
    if (status === null) {
      state.connected = true;
      state.sensorOK = false;
      state.temperature = null;
      state.humidity = null;
      state.warning = WAITING_FOR_READING_MESSAGE;
      state.activeWarningKey = state.warning;
      state.warningSilenced = false;
      state.lastUpdated = null;
      state.statusApiState = 'online';
      renderStatus();
      renderReadings();
      renderDiagnostics();
      return;
    }

    applySensorStatus(status);
    state.statusApiState = 'online';
    state.lastError = '';
    renderDiagnostics();
  }

  function handleFirebaseStatusEvent(event) {
    const update = JSON.parse(event.data);
    if (!update || typeof update.path !== 'string') {
      throw new Error('Firebase sent an invalid live status event.');
    }

    const segments = update.path.split('/').filter(Boolean);
    if (segments.length === 0) {
      if (event.type === 'patch' && update.data && typeof update.data === 'object') {
        state.firebaseCurrentStatus = {
          ...(state.firebaseCurrentStatus || {}),
          ...update.data,
        };
      } else {
        state.firebaseCurrentStatus = update.data;
      }
    } else {
      const current = state.firebaseCurrentStatus || {};
      if (segments.length === 1) {
        if (update.data === null) delete current[segments[0]];
        else current[segments[0]] = update.data;
      }
      state.firebaseCurrentStatus = current;
    }

    applyFirebaseStatus(state.firebaseCurrentStatus);
  }

  function renderFirebaseHistory() {
    const history = Array.from(state.firebaseHistoryRecords.values())
      .map(validateHistoryRecord);
    history.sort((left, right) => {
      const leftTime = left.recordedAt ? Date.parse(left.recordedAt) : 0;
      const rightTime = right.recordedAt ? Date.parse(right.recordedAt) : 0;
      return rightTime - leftTime;
    });
    state.history = history.slice(0, 500);
    state.historyApiState = 'online';
    renderHistory();
    renderDiagnostics();
  }

  function handleFirebaseHistoryEvent(event) {
    const update = JSON.parse(event.data);
    if (!update || typeof update.path !== 'string') {
      throw new Error('Firebase sent an invalid live history event.');
    }

    const segments = update.path.split('/').filter(Boolean);
    if (segments.length === 0) {
      if (event.type === 'put' || update.data === null) {
        state.firebaseHistoryRecords.clear();
      }
      if (update.data && typeof update.data === 'object') {
        for (const [key, record] of Object.entries(update.data)) {
          if (record === null) state.firebaseHistoryRecords.delete(key);
          else state.firebaseHistoryRecords.set(key, record);
        }
      }
    } else {
      const key = segments[0];
      if (segments.length === 1) {
        if (update.data === null) state.firebaseHistoryRecords.delete(key);
        else state.firebaseHistoryRecords.set(key, update.data);
      } else if (update.data === null) {
        state.firebaseHistoryRecords.delete(key);
      } else {
        const record = state.firebaseHistoryRecords.get(key) || {};
        let target = record;
        for (const segment of segments.slice(1, -1)) {
          target[segment] = target[segment] || {};
          target = target[segment];
        }
        target[segments[segments.length - 1]] = update.data;
        state.firebaseHistoryRecords.set(key, record);
      }
    }

    renderFirebaseHistory();
  }

  function startFirebaseListeners() {
    if (!IS_FIREBASE_CLOUD_PAGE || typeof EventSource !== 'function') return false;
    try {
      const databaseUrl = new URL(FIREBASE_DATABASE_URL);
      if (databaseUrl.protocol !== 'https:' || databaseUrl.username ||
          databaseUrl.password || databaseUrl.search || databaseUrl.hash) {
        return false;
      }
    } catch (_) {
      return false;
    }

    state.firebaseListenersStarted = true;
    state.connectionType = 'cloud';
    state.statusApiState = 'checking';
    state.historyApiState = 'checking';
    renderDiagnostics();

    state.firebaseStatusSource = new EventSource(
      `${FIREBASE_DATABASE_URL}/sensor/latest.json`,
    );
    state.firebaseHistorySource = new EventSource(
      getApiRequestUrl('/api/history', state.deviceUrl),
    );

    const attachStream = (source, handler, label, setStatus) => {
      for (const type of ['put', 'patch']) {
        source.addEventListener(type, (event) => {
          try {
            handler(event);
            if (state.statusApiState === 'online' &&
                state.historyApiState === 'online') {
              state.lastError = '';
            }
          } catch (error) {
            console.error(`Could not process Firebase ${label}:`, error);
            setStatus('error');
            state.lastError = `Firebase ${label}: ${describeConnectionError(error)}`;
            renderDiagnostics();
          }
        });
      }
      source.addEventListener('cancel', () => {
        setStatus('error');
        state.lastError = `Firebase ${label} stream was rejected by the database rules.`;
        renderDiagnostics();
      });
      source.onerror = () => {
        setStatus('error');
        state.lastError = `Firebase ${label} stream disconnected; waiting to reconnect.`;
        renderDiagnostics();
      };
    };

    attachStream(state.firebaseStatusSource, handleFirebaseStatusEvent, 'status', (value) => {
      state.statusApiState = value;
    });
    attachStream(state.firebaseHistorySource, handleFirebaseHistoryEvent, 'history', (value) => {
      state.historyApiState = value;
    });
    return true;
  }

  function stopFirebaseListeners() {
    state.firebaseStatusSource?.close();
    state.firebaseHistorySource?.close();
    state.firebaseStatusSource = null;
    state.firebaseHistorySource = null;
    state.firebaseListenersStarted = false;
  }

  function describeConnectionError(error) {
    if (error && error.name === 'AbortError') {
      return IS_FIREBASE_CLOUD_PAGE
        ? 'Firebase did not respond in time. Check the internet connection and try again.'
        : 'The ESP32 did not respond in time. Check the Wi-Fi connection and try again.';
    }
    if (error instanceof TypeError) {
      return IS_FIREBASE_CLOUD_PAGE
        ? 'The browser could not reach Firebase Realtime Database. Check the internet connection and database rules.'
        : 'The browser could not reach the ESP32. If this page is hosted elsewhere, check that the ESP32 allows CORS requests.';
    }
    return error instanceof Error
      ? error.message
      : IS_FIREBASE_CLOUD_PAGE
        ? 'Could not load sensor data from Firebase.'
        : 'Could not load data from the ESP32.';
  }

  function getActiveWarning() {
    return state.warning || (!state.sensorOK
      ? 'The ESP32 reports that the sensor needs attention.'
      : '');
  }

  function vibrateForWarning() {
    if (typeof navigator.vibrate === 'function') {
      navigator.vibrate(10000);
    }
  }

  async function stopHardwareWarning() {
    if (IS_FIREBASE_CLOUD_PAGE || state.connectionType === 'bluetooth' || state.stoppingWarning ||
        state.warningSilenced || !state.connected || !getActiveWarning()) {
      return;
    }

    state.stoppingWarning = true;
    state.warningActionMessage = '';
    renderStatus();
    try {
      const response = await fetch(getApiRequestUrl('/api/warning/stop', state.deviceUrl), {
        method: 'POST',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        const detail = (await response.text()).trim().slice(0, 180);
        throw new Error(`HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
      }

      state.warningSilenced = true;
      state.warningActionMessage = 'Hardware alarm silenced. Monitoring remains active.';
      if (typeof navigator.vibrate === 'function') {
        navigator.vibrate(0);
      }
    } catch (error) {
      console.error('Could not silence the hardware warning:', error);
      state.warningActionMessage = `Could not silence hardware alarm: ${describeConnectionError(error)}`;
    } finally {
      state.stoppingWarning = false;
      renderStatus();
    }
  }

  function applySensorStatus(status) {
    const hasValidReadings = typeof status?.temperature === 'number' &&
      Number.isFinite(status.temperature) &&
      typeof status?.humidity === 'number' &&
      Number.isFinite(status.humidity);
    const hasUnavailableReadings = status?.sensorOK === false &&
      status.temperature === null && status.humidity === null;
    if (!status || typeof status !== 'object' ||
        (!hasValidReadings && !hasUnavailableReadings)) {
      throw new Error('The monitor returned an invalid sensor status response.');
    }

    const previousWarningKey = state.activeWarningKey;
    state.temperature = hasValidReadings ? status.temperature : null;
    state.humidity = hasValidReadings ? status.humidity : null;
    state.sensorOK = status.sensorOK === true;
    if (typeof status.warning === 'string') {
      state.warning = status.warning.trim();
    } else if (status.warning === true) {
      state.warning = 'The hardware has reported a warning.';
    } else if (status.warning === false || status.warning == null) {
      state.warning = '';
    } else {
      throw new Error('The ESP32 returned an invalid hardware warning value.');
    }
    const activeWarning = getActiveWarning();
    if (activeWarning !== previousWarningKey) {
      state.warningSilenced = false;
      state.warningActionMessage = '';
      state.activeWarningKey = activeWarning;
      if (activeWarning && activeWarning !== WAITING_FOR_READING_MESSAGE) {
        vibrateForWarning();
      }
    }
    state.connected = true;
    if (status.recordedAt === undefined) {
      state.lastUpdated = new Date();
    } else {
      const recordedAt = new Date(status.recordedAt);
      state.lastUpdated = Number.isFinite(recordedAt.getTime()) ? recordedAt : null;
    }
    state.statusApiState = 'online';
    renderStatus();
    renderReadings();
  }

  async function connectBluetooth() {
    if (!navigator.bluetooth) {
      showMessage('Bluetooth is not available here. Open this page in Android Chrome over HTTPS.', 'error');
      return;
    }

    if (state.bluetoothDevice?.gatt?.connected) {
      state.bluetoothDevice.gatt.disconnect();
      return;
    }

    state.bluetoothReadyForReconnect = false;
    elements.bluetoothConnectButton.disabled = true;
    elements.bluetoothConnectButton.textContent = 'Connecting…';
    try {
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: 'PoultryMonitor' }],
        optionalServices: [BLE_SERVICE_UUID],
      });
      device.addEventListener('gattserverdisconnected', () => {
        if (state.bluetoothDevice !== device) return;
        state.bluetoothDevice = null;
        state.bluetoothCharacteristic = null;
        state.bluetoothHistoryCharacteristic = null;
        state.bluetoothReadyForReconnect = true;
        state.connectionType = IS_FIREBASE_CLOUD_PAGE ? 'cloud' : 'network';
        state.connected = false;
        state.sensorOK = false;
        state.statusApiState = 'error';
        state.historyApiState = 'waiting';
        state.lastError = 'Bluetooth connection to the ESP32 was lost.';
        renderStatus();
        renderDiagnostics();
        if (IS_FIREBASE_CLOUD_PAGE) {
          startFirebaseListeners();
          refreshData();
        }
      }, { once: true });

      const server = await device.gatt.connect();
      const service = await server.getPrimaryService(BLE_SERVICE_UUID);
      state.bluetoothCharacteristic = await service.getCharacteristic(
        BLE_STATUS_CHARACTERISTIC_UUID,
      );
      try {
        state.bluetoothHistoryCharacteristic = await service.getCharacteristic(
          BLE_HISTORY_CHARACTERISTIC_UUID,
        );
      } catch (error) {
        console.warn('ESP32 Bluetooth history is unavailable; update the firmware to restore device history.', error);
        state.bluetoothHistoryCharacteristic = null;
      }
      state.bluetoothDevice = device;
      state.bluetoothReadyForReconnect = false;
      state.connectionType = 'bluetooth';
      stopFirebaseListeners();
      state.history = [];
      state.historyApiState = state.bluetoothHistoryCharacteristic
        ? 'checking'
        : 'not-available';
      state.lastError = '';
      renderHistory();
      await refreshData();
    } catch (error) {
      console.error('Could not connect to the ESP32 over Bluetooth:', error);
      const message = error?.name === 'NotFoundError'
        ? 'Bluetooth device selection was cancelled or the monitor was not found.'
        : error instanceof Error ? error.message : 'Could not connect to the ESP32 over Bluetooth.';
      state.lastError = message;
      state.statusApiState = 'error';
      state.historyApiState = 'not-available';
      elements.connectionMessage.textContent = message;
      renderDiagnostics();
    } finally {
      elements.bluetoothConnectButton.disabled = !navigator.bluetooth;
      renderStatus();
    }
  }

  async function refreshBluetoothData() {
    if (!state.bluetoothCharacteristic) return;
    if (state.refreshing) {
      state.refreshQueued = true;
      return;
    }
    state.refreshing = true;
    elements.refreshButton.classList.add('busy');
    elements.refreshButton.disabled = true;
    state.lastAttemptAt = new Date();
    state.statusApiState = 'checking';
    state.historyApiState = state.bluetoothHistoryCharacteristic ? 'checking' : 'error';
    state.lastError = '';
    renderDiagnostics();
    try {
      const value = await state.bluetoothCharacteristic.readValue();
      const status = JSON.parse(new TextDecoder().decode(value));
      applySensorStatus(status);
      if (state.bluetoothHistoryCharacteristic) {
        try {
          const historyValue = await state.bluetoothHistoryCharacteristic.readValue();
          const historyResponse = JSON.parse(new TextDecoder().decode(historyValue));
          if (!historyResponse || !Array.isArray(historyResponse.history)) {
            throw new Error('ESP32 returned an invalid Bluetooth history response.');
          }
          state.history = historyResponse.history.map((record) => {
            if (!Array.isArray(record) || record.length !== 3) return record;
            return {
              temperature: record[0],
              humidity: record[1],
              elapsedMs: typeof record[2] === 'number' ? record[2] * 1000 : null,
            };
          }).map(validateHistoryRecord).reverse();
          state.historyApiState = 'online';
          renderHistory();
        } catch (error) {
          console.error('Could not restore sensor history over Bluetooth:', error);
          state.historyApiState = 'error';
          state.lastError = `Bluetooth history: ${describeConnectionError(error)}`;
        }
      } else {
        state.historyApiState = 'not-available';
      }
    } catch (error) {
      console.error('Could not read sensor status over Bluetooth:', error);
      state.connected = false;
      state.sensorOK = false;
      state.statusApiState = 'error';
      state.lastError = error instanceof Error
        ? `Bluetooth status: ${error.message}`
        : 'Could not read sensor status over Bluetooth.';
      elements.connectionMessage.textContent = state.lastError;
      renderStatus();
      renderReadings();
    } finally {
      renderHistory();
      renderDiagnostics();
      state.refreshing = false;
      elements.refreshButton.classList.remove('busy');
      elements.refreshButton.disabled = false;
      if (state.refreshQueued) {
        state.refreshQueued = false;
        window.setTimeout(refreshData, 0);
      }
    }
  }

  async function refreshData() {
    if (state.bluetoothCharacteristic) {
      await refreshBluetoothData();
      return;
    }
    if (IS_FIREBASE_CLOUD_PAGE) state.connectionType = 'cloud';

    if (state.refreshing) {
      state.refreshQueued = true;
      return;
    }

    const protocolMessage = getHttpsHttpMismatchMessage(state.deviceUrl);
    if (protocolMessage) {
      state.connected = false;
      state.sensorOK = false;
      state.statusApiState = 'error';
      state.historyApiState = 'error';
      state.lastAttemptAt = new Date();
      state.lastError = protocolMessage;
      renderStatus();
      elements.connectionMessage.textContent = protocolMessage;
      renderDiagnostics();
      return;
    }

    state.refreshing = true;
    elements.refreshButton.classList.add('busy');
    elements.refreshButton.disabled = true;
    const requestedUrl = state.deviceUrl;
    state.lastAttemptAt = new Date();
    state.statusApiState = 'checking';
    state.historyApiState = 'checking';
    state.lastError = '';
    renderDiagnostics();

    const errors = [];
    try {
      const status = await requestJson('/api/status', requestedUrl);
      if (requestedUrl !== state.deviceUrl) return;
      applySensorStatus(status);
    } catch (error) {
      console.error('Could not load sensor status:', error);
      if (requestedUrl === state.deviceUrl) {
        state.connected = false;
        state.sensorOK = false;
        state.warning = '';
        state.activeWarningKey = '';
        state.warningSilenced = false;
        state.warningActionMessage = '';
        state.statusApiState = 'error';
        errors.push(`Status endpoint: ${describeConnectionError(error)}`);
        renderStatus();
        elements.connectionMessage.textContent = describeConnectionError(error);
        renderReadings();
      }
    } finally {
      if (requestedUrl === state.deviceUrl) {
        try {
          const history = await requestJson('/api/history', requestedUrl);
          if (!history || !Array.isArray(history.history)) {
            throw new Error('The ESP32 returned an invalid history response.');
          }
          if (requestedUrl !== state.deviceUrl) return;
          state.history = history.history.map(validateHistoryRecord);
          state.historyApiState = 'online';
          renderHistory();
        } catch (error) {
          console.error('Could not load sensor history:', error);
          state.historyApiState = 'error';
          errors.push(`History endpoint: ${describeConnectionError(error)}`);
          elements.recentList.innerHTML = '<div class="empty-state">SQL history is temporarily unavailable. The live readings are still updating.</div>';
          elements.historyList.innerHTML = '<div class="empty-state">Could not load history from the local SQL database.</div>';
          elements.historyChart.innerHTML = '<div class="chart-empty">Could not load SQL history.</div>';
        }
        state.lastError = errors.join(' ');
        renderDiagnostics();
      }
      state.refreshing = false;
      elements.refreshButton.classList.remove('busy');
      elements.refreshButton.disabled = false;
      if (state.refreshQueued) {
        state.refreshQueued = false;
        window.setTimeout(refreshData, 0);
      }
    }
  }

  async function saveDeviceAddress(event) {
    event.preventDefault();
    const newUrl = normalizeUrl(elements.deviceUrlInput.value);
    if (!isValidDeviceUrl(newUrl)) {
      showMessage('Enter a valid base URL, for example http://192.168.4.1', 'error');
      elements.deviceUrlInput.focus();
      return;
    }

    state.deviceUrl = newUrl;
    elements.deviceUrlInput.value = newUrl;
    elements.sidebarAddress.textContent = newUrl.replace(/^https?:\/\//, '');
    elements.deviceAddressLabel.textContent = newUrl.replace(/^https?:\/\//, '');
    elements.saveButton.disabled = true;
    elements.saveButton.textContent = 'Saving…';

    try {
      localStorage.setItem(STORAGE_KEY, newUrl);
      showMessage('Address saved. Checking the ESP32 connection…', 'success');
    } catch (error) {
      console.error('Could not save the device address:', error);
      showMessage('Could not save settings in this browser. Check storage permissions.', 'error');
      elements.saveButton.disabled = false;
      elements.saveButton.innerHTML = 'Save & connect <svg><use href="#icon-arrow"></use></svg>';
      return;
    }

    await refreshData();
    elements.saveButton.disabled = false;
    elements.saveButton.innerHTML = 'Save & connect <svg><use href="#icon-arrow"></use></svg>';
    if (state.connected) {
      showMessage('Address saved and ESP32 connected.', 'success');
    } else {
      showMessage('Address saved, but the ESP32 is not reachable yet.', 'error');
    }
  }

  function initialize() {
    applyTheme(getSavedTheme());
    elements.deviceUrlInput.value = state.deviceUrl;
    elements.sidebarAddress.textContent = state.deviceUrl.replace(/^https?:\/\//, '');
    elements.deviceAddressLabel.textContent = state.deviceUrl.replace(/^https?:\/\//, '');

    $$('[data-page]').forEach((button) => {
      button.addEventListener('click', () => setPage(button.dataset.page));
    });
    $$('[data-page-link]').forEach((link) => {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        setPage(link.dataset.pageLink);
      });
    });
    elements.refreshButton.addEventListener('click', refreshData);
    elements.bluetoothConnectButton.addEventListener('click', connectBluetooth);
    elements.stopWarningButton.addEventListener('click', stopHardwareWarning);
    elements.settingsForm.addEventListener('submit', saveDeviceAddress);
    elements.darkModeToggle.addEventListener('change', saveThemePreference);
    elements.installButton.addEventListener('click', installApp);

    setupProgressiveWebApp();
    const initialPage = window.location.hash.slice(1);
    setPage(pageInfo[initialPage] ? initialPage : 'home');
    renderStatus();
    renderReadings();
    renderHistory();
    startFirebaseListeners();
    refreshData();
    state.timer = window.setInterval(
      () => {
        if (state.firebaseListenersStarted) {
          renderStatus();
          renderReadings();
        } else {
          refreshData();
        }
      },
      REFRESH_INTERVAL_MS,
    );
  }

  initialize();
})();
