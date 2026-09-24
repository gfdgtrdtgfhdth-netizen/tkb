FROM node:20-slim

WORKDIR /app

# Cài đặt cờ chứng chỉ mạng an toàn
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*

# Copy khai báo phụ thuộc và cài đặt
COPY package*.json ./
RUN npm install --omit=dev

# Copy mã nguồn chính
COPY index.js .

# Lệnh khởi chạy Bot
CMD ["node", "index.js"]
