FROM node:20-bookworm

WORKDIR /app

RUN apt-get update && apt-get install -y \
    ffmpeg \
    cmake \
    build-essential \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm ci

COPY . .

# Build whisper.cpp
RUN if [ -f whisper.cpp/CMakeLists.txt ]; then \
      cmake -S whisper.cpp -B whisper.cpp/build -DCMAKE_BUILD_TYPE=Release && \
      cmake --build whisper.cpp/build --config Release -j2; \
    fi

# Download the Whisper base English model into the exact
# location expected by the application.
RUN curl -L \
    https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin \
    -o /app/whisper.cpp/ggml-base.en.bin

# Verify the model exists
RUN test -f /app/whisper.cpp/ggml-base.en.bin

RUN npm run build

EXPOSE 3000

ENV NODE_ENV=production

CMD ["npm", "start"]