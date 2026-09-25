FROM node:20-bookworm

WORKDIR /app

RUN apt-get update && apt-get install -y \
    ffmpeg \
    cmake \
    build-essential \
    git \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm ci

COPY . .

RUN if [ -f whisper.cpp/CMakeLists.txt ]; then \
      cmake -S whisper.cpp -B whisper.cpp/build -DCMAKE_BUILD_TYPE=Release && \
      cmake --build whisper.cpp/build --config Release -j2; \
    fi

RUN npm run build

EXPOSE 3000

ENV NODE_ENV=production

CMD ["npm", "start"]