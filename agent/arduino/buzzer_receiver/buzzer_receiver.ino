#include <RCSwitch.h>

const unsigned long SERIAL_BAUD = 9600;
const int RECEIVER_INTERRUPT = 0;
const unsigned long ALIVE_INTERVAL_MS = 5000;
const unsigned long REPEAT_GAP_MS = 400;
const byte TRACKED_CODES = 8;

struct SeenCode {
  unsigned long value;
  unsigned long lastSeenAt;
};

RCSwitch receiver = RCSwitch();
SeenCode seenCodes[TRACKED_CODES];
byte seenCount = 0;
unsigned long lastAliveAt = 0;

void setup() {
  Serial.begin(SERIAL_BAUD);
  receiver.enableReceive(RECEIVER_INTERRUPT);
  Serial.println(F("HELLO fete-receiver 1"));
  lastAliveAt = millis();
}

void loop() {
  if (receiver.available()) {
    unsigned long value = receiver.getReceivedValue();
    receiver.resetAvailable();
    if (value != 0 && isNewPress(value, millis())) {
      Serial.print(F("BUZZ "));
      Serial.println(value);
    }
  }

  unsigned long now = millis();
  if (now - lastAliveAt >= ALIVE_INTERVAL_MS) {
    lastAliveAt = now;
    Serial.println(F("ALIVE"));
  }
}

bool isNewPress(unsigned long value, unsigned long now) {
  for (byte i = 0; i < seenCount; i++) {
    if (seenCodes[i].value == value) {
      bool quietLongEnough = now - seenCodes[i].lastSeenAt >= REPEAT_GAP_MS;
      seenCodes[i].lastSeenAt = now;
      return quietLongEnough;
    }
  }
  remember(value, now);
  return true;
}

void remember(unsigned long value, unsigned long now) {
  byte slot = seenCount < TRACKED_CODES ? seenCount++ : leastRecentlySeenSlot(now);
  seenCodes[slot].value = value;
  seenCodes[slot].lastSeenAt = now;
}

byte leastRecentlySeenSlot(unsigned long now) {
  byte oldest = 0;
  for (byte i = 1; i < TRACKED_CODES; i++) {
    if (now - seenCodes[i].lastSeenAt > now - seenCodes[oldest].lastSeenAt) {
      oldest = i;
    }
  }
  return oldest;
}
