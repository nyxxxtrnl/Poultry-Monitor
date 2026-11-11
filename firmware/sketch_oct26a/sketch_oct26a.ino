
#include <SPI.h>
#include <WiFi.h>
#include <WebServer.h>
#include <Preferences.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <ArduinoJson.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ILI9341.h>
#include <DHT.h>
#include <XPT2046_Touchscreen.h>
#include <math.h>
#include <string.h>
#include "dashboard_assets.h"
#include "wifi_secrets.h"

// =====================================================
// 1. PIN CONFIGURATION
// =====================================================

// TFT ILI9341 - ORIGINAL WORKING PINS
#define TFT_CS    14
#define TFT_DC    47
#define TFT_RST   21
#define TFT_SCK   3
#define TFT_MISO  46
#define TFT_MOSI  45

// DHT22
#define DHT_PIN   4
#define DHT_TYPE  DHT22

// BUZZER
#define BUZZER_PIN 5
#define BUZZER_ACTIVE_LOW true

// LED
#define LED_PIN 6

// XPT2046 TOUCHSCREEN - SEPARATE SPI
#define TOUCH_CS   1
#define TOUCH_CLK  42
#define TOUCH_MISO 41
#define TOUCH_MOSI 2

// Touch calibration starting values
#define TOUCH_X_MIN 200
#define TOUCH_X_MAX 3800
#define TOUCH_Y_MIN 200
#define TOUCH_Y_MAX 3800

#define TOUCH_PRESSURE_MIN 40

// =====================================================
// 2. WIFI CONFIGURATION
// =====================================================

const char* AP_SSID = "PoultryMonitor";
const char* AP_PASSWORD = "PoultryMonitor123";

WebServer server(80);

static const char BLE_SERVICE_UUID[] = "a3c87500-8ed3-4bdf-8a39-a01bebede295";
static const char BLE_STATUS_CHARACTERISTIC_UUID[] = "a3c87501-8ed3-4bdf-8a39-a01bebede295";
BLECharacteristic* bleStatusCharacteristic = nullptr;

static const char LETS_ENCRYPT_ROOT_CA[] PROGMEM = R"PEM(
-----BEGIN CERTIFICATE-----
MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw
TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh
cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4
WhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu
ZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY
MTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3oJHP0FDfzm54rVygc
h77ct984kIxuPOZXoHj3dcKi/vVqbvYATyjb3miGbESTtrFj/RQSa78f0uoxmyF+
0TM8ukj13Xnfs7j/EvEhmkvBioZxaUpmZmyPfjxwv60pIgbz5MDmgK7iS4+3mX6U
A5/TR5d8mUgjU+g4rk8Kb4Mu0UlXjIB0ttov0DiNewNwIRt18jA8+o+u3dpjq+sW
T8KOEUt+zwvo/7V3LvSye0rgTBIlDHCNAymg4VMk7BPZ7hm/ELNKjD+Jo2FR3qyH
B5T0Y3HsLuJvW5iB4YlcNHlsdu87kGJ55tukmi8mxdAQ4Q7e2RCOFvu396j3x+UC
B5iPNgiV5+I3lg02dZ77DnKxHZu8A/lJBdiB3QW0KtZB6awBdpUKD9jf1b0SHzUv
KBds0pjBqAlkd25HN7rOrFleaJ1/ctaJxQZBKT5ZPt0m9STJEadao0xAH0ahmbWn
OlFuhjuefXKnEgV4We0+UXgVCwOPjdAvBbI+e0ocS3MFEvzG6uBQE3xDk3SzynTn
jh8BCNAw1FtxNrQHusEwMFxIt4I7mKZ9YIqioymCzLq9gwQbooMDQaHWBfEbwrbw
qHyGO0aoSCqI3Haadr8faqU9GY/rOPNk3sgrDQoo//fb4hVC1CLQJ13hef4Y53CI
rU7m2Ys6xt0nUW7/vGT1M0NPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNV
HRMBAf8EBTADAQH/MB0GA1UdDgQWBBR5tFnme7bl5AFzgAiIyBpY9umbbjANBgkq
hkiG9w0BAQsFAAOCAgEAVR9YqbyyqFDQDLHYGmkgJykIrGF1XIpu+ILlaS/V9lZL
ubhzEFnTIZd+50xx+7LSYK05qAvqFyFWhfFQDlnrzuBZ6brJFe+GnY+EgPbk6ZGQ
3BebYhtF8GaV0nxvwuo77x/Py9auJ/GpsMiu/X1+mvoiBOv/2X/qkSsisRcOj/KK
NFtY2PwByVS5uCbMiogziUwthDyC3+6WVwW6LLv3xLfHTjuCvjHIInNzktHCgKQ5
ORAzI4JMPJ+GslWYHb4phowim57iaztXOoJwTdwJx4nLCgdNbOhdjsnvzqvHu7Ur
TkXWStAmzOVyyghqpZXjFaH3pO3JLF+l+/+sKAIuvtd7u+Nxe5AW0wdeRlN8NwdC
jNPElpzVmbUq4JUagEiuTDkHzsxHpFKVK7q4+63SM1N95R1NbdWhscdCb+ZAJzVc
oyi3B43njTOQ5yOf+1CceWxG1bQVs5ZufpsMljq4Ui0/1lvh+wjChP4kqKOJ2qxq
4RgqsahDYVvTH9w7jXbyLeiNdd8XM2w9U/t7y0Ff/9yi0GE44Za4rF2LN9d11TPA
mRGunUHBcnWEvgJBQl9nJEiU0Zsnvgc/ubhPgXRR4Xq37Z0j4r7g1SgEEzwxA57d
emyPxgcYxn/eR44/KJ4EBs+lVDR3veyJm+kXQ99b21/+jh5Xos1AnX5iItreGCc=
-----END CERTIFICATE-----
)PEM";

const unsigned long CLOUD_UPLOAD_INTERVAL = 10000;
const unsigned long WIFI_RETRY_INTERVAL = 30000;
const unsigned long BLE_STATUS_UPDATE_INTERVAL = 1000;
unsigned long lastCloudUpload = 0;
unsigned long lastWifiAttempt = 0;
unsigned long lastBleStatusUpdate = 0;

// =====================================================
// 3. SENSOR AND ALARM SETTINGS
// =====================================================

#define TEMP_LIMIT 33.0
#define HUM_LIMIT  85.0

#define SENSOR_INTERVAL 2000
#define HISTORY_INTERVAL 10000
#define ALARM_INTERVAL 300

float tempC = 0.0;
float humidity = 0.0;

bool sensorOK = false;
bool alarmActive = false;
bool buzzerState = false;

// STOP BUTTON STATE
bool alarmSilenced = false;

unsigned long lastSensorRead = 0;
unsigned long lastHistorySave = 0;
unsigned long lastAlarmToggle = 0;
unsigned long lastTouch = 0;

// =====================================================
// 4. DISPLAY AND SENSOR OBJECTS
// =====================================================

// ORIGINAL TFT INITIALIZATION
Adafruit_ILI9341 tft(
  TFT_CS,
  TFT_DC,
  TFT_RST
);

DHT dht(DHT_PIN, DHT_TYPE);

// Separate SPI bus for touchscreen
SPIClass touchSPI(HSPI);

XPT2046_Touchscreen ts(TOUCH_CS);

// =====================================================
// 5. PREFERENCES / HISTORY
// =====================================================

Preferences preferences;

struct SensorRecord {
  float temperature;
  float humidity;
  unsigned long elapsedSec;
};

const int MAX_HISTORY = 10;

SensorRecord historyData[MAX_HISTORY];
int historyCount = 0;

// =====================================================
// 6. SCREEN PAGES
// =====================================================

enum ScreenPage {
  PAGE_HOME,
  PAGE_WEATHER,
  PAGE_HISTORY,
  PAGE_SETTINGS
};

ScreenPage currentPage = PAGE_HOME;

bool screenDirty = true;
bool valuesDirty = true;

// =====================================================
// 7. COLORS
// =====================================================

#define COLOR_BG       0x0841
#define COLOR_CARD     0x10A2
#define COLOR_WHITE    ILI9341_WHITE
#define COLOR_GREEN    ILI9341_GREEN
#define COLOR_RED      ILI9341_RED
#define COLOR_BLUE     ILI9341_CYAN
#define COLOR_YELLOW   ILI9341_YELLOW
#define COLOR_GRAY     0x8410
#define COLOR_ORANGE   0xFD20

// =====================================================
// 8. BUZZER CONTROL
// =====================================================

void setBuzzer(bool on) {
  if (BUZZER_ACTIVE_LOW) {
    digitalWrite(BUZZER_PIN, on ? LOW : HIGH);
  } else {
    digitalWrite(BUZZER_PIN, on ? HIGH : LOW);
  }
}

// =====================================================
// 9. HISTORY FUNCTIONS
// =====================================================

void saveHistoryToMemory() {
  DynamicJsonDocument doc(4096);

  JsonArray arr = doc.to<JsonArray>();

  for (int i = 0; i < historyCount; i++) {
    JsonObject item = arr.createNestedObject();

    item["temperature"] = historyData[i].temperature;
    item["humidity"] = historyData[i].humidity;
    item["elapsedSec"] = historyData[i].elapsedSec;
  }

  String output;
  serializeJson(doc, output);

  preferences.putString("history", output);
}

void loadHistory() {
  String saved = preferences.getString("history", "[]");

  DynamicJsonDocument doc(4096);

  DeserializationError error = deserializeJson(doc, saved);

  if (error) {
    historyCount = 0;
    return;
  }

  JsonArray arr = doc.as<JsonArray>();

  historyCount = 0;

  for (JsonObject item : arr) {
    if (historyCount >= MAX_HISTORY) break;

    historyData[historyCount].temperature =
      item["temperature"] | 0.0;

    historyData[historyCount].humidity =
      item["humidity"] | 0.0;

    historyData[historyCount].elapsedSec =
      item["elapsedSec"] | 0UL;

    historyCount++;
  }
}

void addHistoryRecord() {
  if (!sensorOK) return;

  if (historyCount < MAX_HISTORY) {
    historyData[historyCount].temperature = tempC;
    historyData[historyCount].humidity = humidity;
    historyData[historyCount].elapsedSec = millis() / 1000UL;

    historyCount++;
  } else {
    for (int i = 0; i < MAX_HISTORY - 1; i++) {
      historyData[i] = historyData[i + 1];
    }

    historyData[MAX_HISTORY - 1].temperature = tempC;
    historyData[MAX_HISTORY - 1].humidity = humidity;
    historyData[MAX_HISTORY - 1].elapsedSec = millis() / 1000UL;
  }

  saveHistoryToMemory();
}

// =====================================================
// 10. SENSOR READING
// =====================================================

void readSensor() {
  float newTemp = dht.readTemperature();
  float newHumidity = dht.readHumidity();

  if (isnan(newTemp) || isnan(newHumidity)) {
    sensorOK = false;

    Serial.println("DHT22 ERROR: Failed to read sensor");

    valuesDirty = true;
    return;
  }

  tempC = newTemp;
  humidity = newHumidity;

  sensorOK = true;

  Serial.print("Temperature: ");
  Serial.print(tempC, 1);
  Serial.print(" C | Humidity: ");
  Serial.print(humidity, 1);
  Serial.println(" %");

  valuesDirty = true;
}

// =====================================================
// 11. ALARM + LED CONTROL
// =====================================================

void updateAlarm() {

  bool newAlarm = false;

  if (sensorOK) {
    if (tempC >= TEMP_LIMIT || humidity >= HUM_LIMIT) {
      newAlarm = true;
    }
  }

  // Detect alarm state changes
  if (newAlarm != alarmActive) {

    alarmActive = newAlarm;

    valuesDirty = true;

    // Reset STOP state when alarm clears
    if (!alarmActive) {
      alarmSilenced = false;
    }

    // New alarm should sound again
    if (alarmActive) {
      alarmSilenced = false;
      lastAlarmToggle = millis();
    }
  }

  // No alarm
  if (!alarmActive) {

    buzzerState = false;

    setBuzzer(false);
    digitalWrite(LED_PIN, LOW);

    return;
  }

  // User pressed STOP
  if (alarmSilenced) {

    buzzerState = false;

    setBuzzer(false);
    digitalWrite(LED_PIN, LOW);

    return;
  }

  // Normal alarm blinking
  if (millis() - lastAlarmToggle >= ALARM_INTERVAL) {

    lastAlarmToggle = millis();

    buzzerState = !buzzerState;

    setBuzzer(buzzerState);

    digitalWrite(
      LED_PIN,
      buzzerState ? HIGH : LOW
    );
  }
}

// =====================================================
// 12. STOP ALARM FUNCTION
// =====================================================

void stopAlarm() {

  if (!alarmActive) return;

  alarmSilenced = true;

  buzzerState = false;

  setBuzzer(false);

  digitalWrite(LED_PIN, LOW);

  valuesDirty = true;

  Serial.println("ALARM STOPPED BY USER");
}

// =====================================================
// 13. DISPLAY HEADER
// =====================================================

void drawHeader(const char* title) {

  tft.fillRect(0, 0, 320, 35, ILI9341_NAVY);

  tft.setTextColor(COLOR_WHITE);
  tft.setTextSize(2);

  tft.setCursor(10, 10);
  tft.print(title);

  tft.drawFastHLine(0, 35, 320, COLOR_BLUE);
}

// =====================================================
// 14. DISPLAY NAVIGATION
// =====================================================

void drawNavigation() {

  const char* labels[4] = {
    "HOME",
    "WEATHER",
    "HISTORY",
    "SETTINGS"
  };

  for (int i = 0; i < 4; i++) {

    int x = i * 80;

    uint16_t color =
      (currentPage == i) ? ILI9341_BLUE : COLOR_CARD;

    tft.fillRect(x, 204, 80, 36, color);

    tft.drawRect(x, 204, 80, 36, COLOR_GRAY);

    tft.setTextSize(1);
    tft.setTextColor(COLOR_WHITE);

    int textWidth = strlen(labels[i]) * 6;

    tft.setCursor(x + (80 - textWidth) / 2, 218);

    tft.print(labels[i]);
  }
}

// =====================================================
// 15. HOME PAGE
// =====================================================

void drawHomePage() {

  drawHeader("POULTRY MONITOR");

  // Temperature card
  tft.fillRoundRect(
    10, 48, 145, 85,
    COLOR_CARD, 8
  );

  tft.setTextColor(COLOR_ORANGE);
  tft.setTextSize(2);
  tft.setCursor(20, 58);
  tft.print("TEMP");

  // Humidity card
  tft.fillRoundRect(
    165, 48, 145, 85,
    COLOR_CARD, 8
  );

  tft.setTextColor(COLOR_BLUE);
  tft.setTextSize(2);
  tft.setCursor(175, 58);
  tft.print("HUMIDITY");

  // Sensor status label
  tft.setTextSize(2);
  tft.setCursor(15, 145);
  tft.setTextColor(COLOR_WHITE);
  tft.print("SENSOR:");

  // Alarm status label
  tft.setCursor(15, 175);
  tft.setTextColor(COLOR_WHITE);
  tft.print("ALARM:");

  updateHomeValues();
}

// =====================================================
// 16. WEATHER PAGE
// =====================================================

void drawWeatherPage() {

  drawHeader("POULTRY CONDITIONS");

  tft.setTextSize(2);
  tft.setTextColor(COLOR_WHITE);

  tft.setCursor(15, 55);
  tft.print("Temperature:");

  tft.setCursor(15, 125);
  tft.print("Humidity:");

  updateWeatherValues();
}

// =====================================================
// 17. PARTIAL HOME VALUE UPDATE
// =====================================================

void updateHomeValues() {

  if (currentPage != PAGE_HOME) return;

  // Temperature value
  tft.fillRect(18, 87, 130, 38, COLOR_CARD);

  tft.setTextColor(COLOR_WHITE);
  tft.setTextSize(3);
  tft.setCursor(20, 90);

  if (sensorOK) {
    tft.print(tempC, 1);
    tft.print(" C");
  } else {
    tft.print("--.- C");
  }

  // Humidity value
  tft.fillRect(173, 87, 130, 38, COLOR_CARD);

  tft.setTextColor(COLOR_WHITE);
  tft.setTextSize(3);
  tft.setCursor(175, 90);

  if (sensorOK) {
    tft.print(humidity, 1);
    tft.print("%");
  } else {
    tft.print("--.-%");
  }

  // Sensor status
  tft.fillRect(112, 143, 190, 25, COLOR_BG);

  tft.setTextSize(2);
  tft.setCursor(115, 145);

  tft.setTextColor(sensorOK ? COLOR_GREEN : COLOR_RED);

  tft.print(sensorOK ? "ONLINE" : "ERROR");

  // Alarm status and STOP button
  tft.fillRect(112, 173, 195, 25, COLOR_BG);

  tft.setTextSize(2);
  tft.setCursor(115, 175);

  if (alarmActive) {

    tft.setTextColor(COLOR_RED);
    tft.print("WARNING!");

    // STOP / MUTED BUTTON
    uint16_t buttonColor =
      alarmSilenced ? COLOR_GRAY : ILI9341_RED;

    tft.fillRoundRect(
      230, 169, 78, 29,
      5, buttonColor
    );

    tft.drawRoundRect(
      230, 169, 78, 29,
      5, COLOR_WHITE
    );

    tft.setTextColor(COLOR_WHITE);
    tft.setTextSize(2);

    if (alarmSilenced) {
      tft.setCursor(237, 177);
      tft.print("MUTED");
    } else {
      tft.setCursor(245, 177);
      tft.print("STOP");
    }

  } else {

    tft.setTextColor(COLOR_GREEN);
    tft.print("NORMAL");
  }
}

// =====================================================
// 18. PARTIAL WEATHER VALUE UPDATE
// =====================================================

void updateWeatherValues() {

  if (currentPage != PAGE_WEATHER) return;

  // Temperature value
  tft.fillRect(12, 80, 295, 38, COLOR_BG);

  tft.setTextSize(3);
  tft.setCursor(15, 82);
  tft.setTextColor(COLOR_ORANGE);

  if (sensorOK) {
    tft.print(tempC, 1);
    tft.print(" C");
  } else {
    tft.print("NO DATA");
  }

  // Humidity value
  tft.fillRect(12, 150, 295, 40, COLOR_BG);

  tft.setTextSize(3);
  tft.setCursor(15, 152);
  tft.setTextColor(COLOR_BLUE);

  if (sensorOK) {
    tft.print(humidity, 1);
    tft.print("%");
  } else {
    tft.print("NO DATA");
  }
}

// =====================================================
// 19. HISTORY PAGE
// =====================================================

void drawHistoryPage() {

  drawHeader("SENSOR HISTORY");

  tft.setTextSize(1);
  tft.setTextColor(COLOR_YELLOW);

  tft.setCursor(10, 45);
  tft.print("UPTIME(s)");

  tft.setCursor(105, 45);
  tft.print("TEMP(C)");

  tft.setCursor(210, 45);
  tft.print("HUMIDITY(%)");

  tft.drawFastHLine(10, 58, 300, COLOR_GRAY);

  if (historyCount == 0) {

    tft.setTextSize(2);
    tft.setTextColor(COLOR_WHITE);
    tft.setCursor(45, 105);
    tft.print("No history yet");

    return;
  }

  int startY = 68;

  for (int i = historyCount - 1; i >= 0; i--) {

    int row = historyCount - 1 - i;

    int y = startY + row * 13;

    if (y > 190) break;

    tft.setTextSize(1);
    tft.setTextColor(COLOR_WHITE);

    tft.setCursor(10, y);
    tft.print(historyData[i].elapsedSec);

    tft.setCursor(105, y);
    tft.print(historyData[i].temperature, 1);

    tft.setCursor(220, y);
    tft.print(historyData[i].humidity, 1);
  }
}

// =====================================================
// 20. SETTINGS PAGE
// =====================================================

void drawSettingsPage() {

  drawHeader("SYSTEM SETTINGS");

  tft.setTextSize(2);
  tft.setTextColor(COLOR_WHITE);

  tft.setCursor(12, 52);
  tft.print("WiFi Access Point");

  tft.setTextSize(2);
  tft.setTextColor(COLOR_GREEN);

  tft.setCursor(12, 78);
  tft.print(AP_SSID);

  tft.setTextSize(2);
  tft.setTextColor(COLOR_WHITE);

  tft.setCursor(12, 110);
  tft.print("IP Address:");

  tft.setTextColor(COLOR_BLUE);

  tft.setCursor(12, 136);
  tft.print("192.168.4.1");

  tft.setTextSize(1);
  tft.setTextColor(COLOR_YELLOW);

  tft.setCursor(12, 166);
  tft.print("TEMP LIMIT: 33 C");

  tft.setCursor(165, 166);
  tft.print("HUM LIMIT: 85%");
}

// =====================================================
// 21. DRAW CURRENT PAGE
// =====================================================

void drawCurrentPage() {

  tft.fillScreen(COLOR_BG);

  switch (currentPage) {

    case PAGE_HOME:
      drawHomePage();
      break;

    case PAGE_WEATHER:
      drawWeatherPage();
      break;

    case PAGE_HISTORY:
      drawHistoryPage();
      break;

    case PAGE_SETTINGS:
      drawSettingsPage();
      break;
  }

  drawNavigation();

  screenDirty = false;
  valuesDirty = false;
}

// =====================================================
// 22. TOUCHSCREEN
// =====================================================

void checkTouch() {

  if (!ts.touched()) return;

  if (millis() - lastTouch < 250) return;

  TS_Point p = ts.getPoint();

  if (p.z < TOUCH_PRESSURE_MIN) return;

  lastTouch = millis();

  // ORIGINAL TOUCH MAPPING
  int x = map(
    p.x,
    TOUCH_X_MIN,
    TOUCH_X_MAX,
    0,
    319
  );

  int y = map(
    p.y,
    TOUCH_Y_MIN,
    TOUCH_Y_MAX,
    0,
    239
  );

  x = constrain(x, 0, 319);
  y = constrain(y, 0, 239);

  Serial.print("RAW X: ");
  Serial.print(p.x);

  Serial.print(" | RAW Y: ");
  Serial.print(p.y);

  Serial.print(" | PRESSURE: ");
  Serial.print(p.z);

  Serial.print(" | SCREEN X: ");
  Serial.print(x);

  Serial.print(" | SCREEN Y: ");
  Serial.println(y);

  // STOP BUTTON ON HOME PAGE
  if (
    currentPage == PAGE_HOME &&
    alarmActive &&
    x >= 230 &&
    x <= 308 &&
    y >= 169 &&
    y <= 198
  ) {

    stopAlarm();

    return;
  }

  // BOTTOM NAVIGATION
  if (y >= 204) {

    if (x < 80) {
      currentPage = PAGE_HOME;
    }
    else if (x < 160) {
      currentPage = PAGE_WEATHER;
    }
    else if (x < 240) {
      currentPage = PAGE_HISTORY;
    }
    else {
      currentPage = PAGE_SETTINGS;
    }

    screenDirty = true;
  }
}

// =====================================================
// 23. API: STATUS
// =====================================================

void handleStatus() {

  DynamicJsonDocument doc(512);

  doc["sensorOK"] = sensorOK;

  if (sensorOK) {

    doc["temperature"] = tempC;
    doc["humidity"] = humidity;

  } else {

    doc["temperature"] = nullptr;
    doc["humidity"] = nullptr;
  }

  doc["alarm"] = alarmActive;
  if (alarmActive) {
    doc["warning"] = "Temperature or humidity is above the configured limit.";
  } else {
    doc["warning"] = nullptr;
  }
  doc["alarmSilenced"] = alarmSilenced;
  doc["buzzer"] = buzzerState;
  doc["led"] = digitalRead(LED_PIN) == HIGH;

  doc["apActive"] = (WiFi.getMode() & WIFI_AP) != 0;

  doc["connectedClients"] = WiFi.softAPgetStationNum();

  doc["temperatureLimit"] = TEMP_LIMIT;
  doc["humidityLimit"] = HUM_LIMIT;

  String response;

  serializeJson(doc, response);

  server.sendHeader("Access-Control-Allow-Origin", "*");

  server.send(
    200,
    "application/json",
    response
  );
}

// =====================================================
// 24. API: HISTORY
// =====================================================

void handleHistory() {

  DynamicJsonDocument doc(6144);

  JsonObject root = doc.to<JsonObject>();
  JsonArray arr = root.createNestedArray("history");

  for (int i = 0; i < historyCount; i++) {

    JsonObject item = arr.createNestedObject();

    item["temperature"] = historyData[i].temperature;
    item["humidity"] = historyData[i].humidity;
    item["elapsedMs"] = static_cast<double>(historyData[i].elapsedSec) * 1000.0;
  }

  String response;

  serializeJson(doc, response);

  server.sendHeader("Access-Control-Allow-Origin", "*");

  server.send(
    200,
    "application/json",
    response
  );
}

void handleStopWarning() {
  stopAlarm();

  DynamicJsonDocument doc(128);
  doc["ok"] = true;
  doc["alarmSilenced"] = alarmSilenced;

  String response;
  serializeJson(doc, response);

  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, "application/json", response);
}

void maintainRouterConnection(unsigned long now) {
  if (strlen(HOME_WIFI_SSID) == 0 || WiFi.status() == WL_CONNECTED ||
      now - lastWifiAttempt < WIFI_RETRY_INTERVAL) {
    return;
  }

  lastWifiAttempt = now;
  Serial.println("Connecting ESP32 station to router Wi-Fi...");
  WiFi.begin(HOME_WIFI_SSID, HOME_WIFI_PASSWORD);
}

void uploadReadingToCloud() {
  if (WiFi.status() != WL_CONNECTED ||
      strlen(CLOUD_API_BASE_URL) == 0 ||
      strlen(DEVICE_INGEST_TOKEN) == 0) {
    return;
  }

  WiFiClientSecure secureClient;
  secureClient.setCACert(LETS_ENCRYPT_ROOT_CA);

  String endpoint = String(CLOUD_API_BASE_URL);
  while (endpoint.endsWith("/")) endpoint.remove(endpoint.length() - 1);
  endpoint += "/ingest";

  HTTPClient http;
  if (!http.begin(secureClient, endpoint)) {
    Serial.println("Could not start HTTPS sensor upload.");
    return;
  }
  http.setTimeout(4000);

  DynamicJsonDocument doc(256);
  doc["sensorOK"] = sensorOK;
  if (sensorOK) {
    doc["temperature"] = tempC;
    doc["humidity"] = humidity;
  } else {
    doc["temperature"] = nullptr;
    doc["humidity"] = nullptr;
  }
  doc["warning"] = alarmActive
    ? "Temperature or humidity is above the configured limit."
    : nullptr;

  String payload;
  serializeJson(doc, payload);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + DEVICE_INGEST_TOKEN);
  const int statusCode = http.POST(payload);
  if (statusCode < 200 || statusCode >= 300) {
    Serial.printf("Sensor upload failed (HTTP %d).\n", statusCode);
  }
  http.end();
}

void updateBleSensorStatus() {
  if (bleStatusCharacteristic == nullptr) return;

  DynamicJsonDocument doc(192);
  doc["sensorOK"] = sensorOK;
  if (sensorOK) {
    doc["temperature"] = tempC;
    doc["humidity"] = humidity;
  } else {
    doc["temperature"] = nullptr;
    doc["humidity"] = nullptr;
  }
  doc["warning"] = alarmActive
    ? "Temperature or humidity is above the configured limit."
    : nullptr;

  String payload;
  serializeJson(doc, payload);
  bleStatusCharacteristic->setValue(payload);
}

void startBluetoothService() {
  BLEDevice::init("PoultryMonitor");
  BLEServer* bleServer = BLEDevice::createServer();
  BLEService* service = bleServer->createService(BLE_SERVICE_UUID);
  bleStatusCharacteristic = service->createCharacteristic(
    BLE_STATUS_CHARACTERISTIC_UUID,
    BLECharacteristic::PROPERTY_READ
  );
  service->start();

  BLEAdvertising* advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(BLE_SERVICE_UUID);
  advertising->setScanResponse(true);
  BLEDevice::startAdvertising();
  Serial.println("Bluetooth LE is advertising as PoultryMonitor.");
}

void handleDashboard() {
  server.send_P(200, "text/html; charset=utf-8", DASHBOARD_HTML);
}

void handleDashboardStyles() {
  server.send_P(200, "text/css; charset=utf-8", DASHBOARD_CSS);
}

void handleDashboardScript() {
  server.send_P(200, "text/javascript; charset=utf-8", DASHBOARD_JS);
}

void handleDashboardCloudConfig() {
  server.send_P(200, "text/javascript; charset=utf-8", DASHBOARD_CLOUD_CONFIG);
}

void handleDashboardManifest() {
  server.send_P(200, "application/manifest+json; charset=utf-8", DASHBOARD_MANIFEST);
}

void handleDashboardIcon192() {
  server.send_P(
    200,
    PSTR("image/png"),
    reinterpret_cast<PGM_P>(DASHBOARD_ICON_192),
    sizeof(DASHBOARD_ICON_192)
  );
}

void handleDashboardIcon512() {
  server.send_P(
    200,
    PSTR("image/png"),
    reinterpret_cast<PGM_P>(DASHBOARD_ICON_512),
    sizeof(DASHBOARD_ICON_512)
  );
}

// =====================================================
// 25. SETUP
// =====================================================

void setup() {

  Serial.begin(115200);

  delay(500);

  Serial.println();
  Serial.println("SMART POULTRY MONITOR STARTING...");

  // Output pins
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(LED_PIN, OUTPUT);

  setBuzzer(false);

  digitalWrite(LED_PIN, LOW);

  // DHT22
  dht.begin();

  // Keep TFT CS inactive during initialization
  pinMode(TFT_CS, OUTPUT);

  digitalWrite(TFT_CS, HIGH);

  // Keep TOUCH CS inactive during initialization
  pinMode(TOUCH_CS, OUTPUT);

  digitalWrite(TOUCH_CS, HIGH);

  // ORIGINAL TFT SPI CONFIGURATION
  SPI.begin(
    TFT_SCK,
    TFT_MISO,
    TFT_MOSI,
    TFT_CS
  );

  tft.begin();

  tft.setRotation(1);

  tft.fillScreen(COLOR_BG);

  // TOUCHSCREEN - SEPARATE SPI BUS
  touchSPI.begin(
    TOUCH_CLK,
    TOUCH_MISO,
    TOUCH_MOSI,
    TOUCH_CS
  );

  ts.begin(touchSPI);

  ts.setRotation(1);

  // Preferences
  preferences.begin("poultry", false);

  loadHistory();

  // WiFi Access Point
  WiFi.mode(WIFI_AP_STA);

  bool apStarted = WiFi.softAP(
    AP_SSID,
    AP_PASSWORD
  );

  Serial.print("WiFi AP: ");

  Serial.println(
    apStarted ? "STARTED" : "FAILED"
  );

  Serial.print("ESP32 IP: ");

  Serial.println(WiFi.softAPIP());
  if (strlen(HOME_WIFI_SSID) > 0) {
    lastWifiAttempt = millis();
    WiFi.begin(HOME_WIFI_SSID, HOME_WIFI_PASSWORD);
  } else {
    Serial.println("Cloud upload disabled: set HOME_WIFI_SSID in wifi_secrets.h.");
  }

  // Web API
  server.on(
    "/api/status",
    HTTP_GET,
    handleStatus
  );

  server.on(
    "/api/history",
    HTTP_GET,
    handleHistory
  );

  server.on(
    "/api/warning/stop",
    HTTP_POST,
    handleStopWarning
  );

  server.on("/", HTTP_GET, handleDashboard);
  server.on("/index.html", HTTP_GET, handleDashboard);
  server.on("/styles.css", HTTP_GET, handleDashboardStyles);
  server.on("/cloud-config.js", HTTP_GET, handleDashboardCloudConfig);
  server.on("/app.js", HTTP_GET, handleDashboardScript);
  server.on("/manifest.webmanifest", HTTP_GET, handleDashboardManifest);
  server.on("/app-icon-192.png", HTTP_GET, handleDashboardIcon192);
  server.on("/app-icon-512.png", HTTP_GET, handleDashboardIcon512);

  server.begin();

  Serial.println("Web server started.");
  startBluetoothService();

  // Initial sensor reading
  readSensor();

  updateAlarm();
  updateBleSensorStatus();

  lastSensorRead = millis();

  lastHistorySave = millis();

  screenDirty = true;

  drawCurrentPage();

  Serial.println("SYSTEM READY");
}

// =====================================================
// 26. MAIN LOOP
// =====================================================

void loop() {

  server.handleClient();

  unsigned long now = millis();
  maintainRouterConnection(now);

  if (now - lastCloudUpload >= CLOUD_UPLOAD_INTERVAL) {
    lastCloudUpload = now;
    uploadReadingToCloud();
  }

  // DHT22 SENSOR READING
  if (now - lastSensorRead >= SENSOR_INTERVAL) {

    lastSensorRead = now;

    readSensor();
  }

  // BUZZER AND LED CONTROL
  updateAlarm();
  if (now - lastBleStatusUpdate >= BLE_STATUS_UPDATE_INTERVAL) {
    lastBleStatusUpdate = now;
    updateBleSensorStatus();
  }

  // SAVE HISTORY
  if (now - lastHistorySave >= HISTORY_INTERVAL) {

    lastHistorySave = now;

    addHistoryRecord();

    if (currentPage == PAGE_HISTORY) {

      screenDirty = true;
    }
  }

  // TOUCHSCREEN
  checkTouch();

  // DISPLAY REFRESH
  if (screenDirty) {

    drawCurrentPage();

  }
  else if (valuesDirty) {

    if (currentPage == PAGE_HOME) {

      updateHomeValues();

    }
    else if (currentPage == PAGE_WEATHER) {

      updateWeatherValues();
    }

    valuesDirty = false;
  }

  delay(1);
}
