FROM node:20-bookworm

WORKDIR /app

RUN apt-get update && apt-get install -y \
    ffmpeg \
    cmake \
    build-essential \
    git \
    wget \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm ci

COPY . .

RUN if [ -f whisper.cpp/CMakeLists.txt ]; then \
      cmake -S whisper.cpp -B whisper.cpp/build -DCMAKE_BUILD_TYPE=Release && \
      cmake --build whisper.cpp/build --config Release -j2; \
    fi

RUN wget -O whisper.cpp/ggml-base.en.bin \
    https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin

RUN npm run build

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["npm", "start"]