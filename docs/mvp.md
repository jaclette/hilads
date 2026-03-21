# Hilads — MVP Definition

## 🧠 Vision

Hilads is a social travel app that instantly connects users to a local city chat without friction.

No signup. No search. Just open → connect → chat.

---

## 🎯 MVP Goal

Validate one core assumption:

👉 Travelers want to instantly connect with people nearby without friction.

---

## 🚀 MVP Features (v1)

### 1. Geolocation
- Get user location (lat/lng)
- Resolve nearest major city

### 2. Auto Channel Join
- User is automatically placed in a city channel
- No selection UI

### 3. Anonymous Identity
- Random nickname generated
- Example: `BlueTiger42`, `CrazyBanana7`

### 4. Public Chat
- Read messages in city channel
- Send text messages

### 5. Basic UI
- Chat screen (main)
- Minimal header (city name)
- Message input

---

## ❌ Not in MVP

- No login
- No private chat
- No images
- No notifications
- No premium
- No multi-channel
- No profiles

---

## 🧱 Architecture Overview

### Frontend
- React (web)
- Simple chat interface

### Backend
- PHP API
- REST endpoints
- MySQL database

### Infra (later)
- Hosting
- CDN
- WebSocket (optional later)

---

## 🗂️ Core Concepts

### User (anonymous)
- Temporary identity
- Stored via guest session

### City
- Predefined dataset
- Used to assign channels

### Channel
- One channel per city

### Message
- Text message in a channel

---

## 🔌 API v1

### Create guest session
POST /api/v1/guest/session

Response:
{
"guestId": "...",
"nickname": "BlueTiger42"
}

---

### Resolve location
POST /api/v1/location/resolve

Body:
{
"lat": 10.8231,
"lng": 106.6297
}

Response:
{
"city": "Ho Chi Minh City",
"channelId": 123
}

---

### Get messages
GET /api/v1/channels/{channelId}/messages

---

### Send message
POST /api/v1/channels/{channelId}/messages

Body:
{
"guestId": "...",
"content": "Anyone up for beers tonight?"
}

---

## 🗃️ Database (v1)

### cities
- id
- name
- country
- lat
- lng
- population

---

### channels
- id
- city_id

---

### guest_sessions
- id
- nickname
- created_at

---

### messages
- id
- channel_id
- guest_id
- content
- created_at

---

## 📈 Success Metrics

- Messages per user
- Time to first message
- Active users per city
- Messages per channel

---

## ⚠️ Risks

- Empty channels (cold start)
- Spam / trolls
- Low retention

---

## 🔥 Next Steps After MVP

- Login system
- Private messages
- Notifications
- Photo upload
- Events (meetups)