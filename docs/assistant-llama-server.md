# Site assistant: backends, secrets, llama-server

The assistant (`POST /api/assistant`, `worker/assistant*.mjs`) talks only to the owner's own `llama-server` instances (llama.cpp, OpenAI-compatible
`/v1/chat/completions`, streaming). No external AI service. Addresses and tokens live **only** in Worker secrets, never in this repository.

## Worker configuration (not in the repository)

Secret `ASSISTANT_BACKENDS` (JSON, lower `priority` first, the next one is the reserve):

```json
[
  {"name": "fedora-cuda",  "url": "https://llm-a.example.net", "token": "<key of that server>", "priority": 1},
  {"name": "amd-vulkan",   "url": "https://llm-b.example.net", "token": "<key>",                "priority": 2},
  {"name": "pc2-nvidia",   "url": "https://llm-c.example.net", "token": "<key>",                "priority": 3, "headers": {"CF-Access-Client-Id": "<id>", "CF-Access-Client-Secret": "<secret>"}}
]
```

```bash
wrangler secret put ASSISTANT_BACKENDS      # paste the JSON
```

The Worker runs in Cloudflare, so each backend must be reachable from there: a Cloudflare Tunnel hostname per server (optionally behind Cloudflare Access, hence the optional
`headers`), or any other HTTPS endpoint. Keep `llama-server` itself bound to localhost/LAN and protected by `--api-key-file`.

One concurrent request per backend, the queue and the per-IP rate limit need shared state: add a Durable Object binding to the Worker's wrangler config
(the class `AssistantGate` is exported by `worker/index.mjs`):

```toml
[[durable_objects.bindings]]
name = "ASSIST_GATE"
class_name = "AssistantGate"

[[migrations]]
tag = "assistant-gate-1"
new_classes = ["AssistantGate"]
```

Without the binding the same logic runs per Worker isolate (best effort: limits are then not global). The package built by the admin contains the knowledge base at
`api/_private/assistant.json`; it sits under `/api/`, which only the Worker answers, so browsers cannot download it.

Limits (code defaults in `worker/assistant.mjs`): 12 requests per IP per 10 min, 12 messages of at most 600 characters (3000 in total), 450 output tokens, a queue of 4 for
12 s, then `503 busy` («зайнято, спробуйте за хвилину»), a failed backend is skipped for 30 s.

## llama-server with systemd

Both units keep `--parallel 1`: one request at a time, matching the Worker's one-slot-per-backend gate. The API key sits in a root-only file.

```bash
sudo install -m 600 /dev/null /etc/llama/api-key      # then put one line with the key into it
```

Vulkan (AMD APU, `llama-server` built with `-DGGML_VULKAN=ON`), `/etc/systemd/system/llama-assistant.service`:

```ini
[Unit]
Description=llama-server for the site assistant (Vulkan)
After=network-online.target

[Service]
User=llama
SupplementaryGroups=render video
Environment=GGML_VK_VISIBLE_DEVICES=0
ExecStart=/opt/llama.cpp/build/bin/llama-server \
  --model /srv/models/assistant.gguf --host 127.0.0.1 --port 8080 \
  --parallel 1 --ctx-size 4096 --n-gpu-layers 99 --api-key-file /etc/llama/api-key
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

CUDA (NVIDIA, built with `-DGGML_CUDA=ON`):

```ini
[Unit]
Description=llama-server for the site assistant (CUDA)
After=network-online.target

[Service]
User=llama
Environment=CUDA_VISIBLE_DEVICES=0
ExecStart=/opt/llama.cpp/build/bin/llama-server \
  --model /srv/models/assistant.gguf --host 127.0.0.1 --port 8080 \
  --parallel 1 --ctx-size 4096 --n-gpu-layers 99 --flash-attn on --api-key-file /etc/llama/api-key
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now llama-assistant
curl -s -H "Authorization: Bearer $(sudo cat /etc/llama/api-key)" http://127.0.0.1:8080/v1/models
```

The model file and the exact flags (`--flash-attn`, context size) depend on the llama.cpp build and the model; adjust them on the machine. Prefer an instruct model that follows
system prompts well and answers in Ukrainian, English and German.

## Enabling

Admin → «Помічник» → switch on, review the facts and the hidden words → build → publish. Off (the default) ships no assistant file and adds nothing to the HTML.
