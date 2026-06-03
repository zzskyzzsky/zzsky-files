# MacBook (zzsky-mbp) 配置指南

> 本文档指导你在 MacBook（Ubuntu 24.04）上完成 Tailscale、Clash、Hermes Agent 的安装和配置，最终实现：
> - **mac-小钉hermes**（MacBook 上的 Hermes 实例）在钉钉上与你独立对话
> - 通过 **Tether** 桥与 ThinkPad 上的 **tp-小钉hermes** 互相通信

---

## 前置条件

- MacBook 已安装 Ubuntu 24.04（带 `nomodeset` 启动）
- WiFi 已连接（BCM4331 使用 brcmsmac 驱动）
- 已安装 Chrome、VS Code、钉钉

---

## 第一步：Tailscale 组网

> 两台机器（ThinkPad + MacBook）组建加密私有网络，是后续所有互联的基础。

```bash
# 1. 安装 Tailscale
curl -fsSL https://tailscale.com/install.sh | sudo sh

# 2. 启动并认证
sudo tailscale up
```

浏览器会弹出认证页面，登录你的 Tailscale 账号（zzskyzzsky@）。

```bash
# 3. 验证连通性
tailscale status
# 应该看到两台设备：
#   zzskytpg3     100.102.54.90  ...  (ThinkPad)
#   zzsky-mbp     100.x.x.x      ...  (MacBook，新分配的 IP)
```

> 🔑 **记录 MacBook 的 Tailscale IP**（如 `100.101.1.2`），后面配置 Tether 要用。

---

## 第二步：配置 Clash 翻墙

> GitHub 和部分资源直连不通，需要代理。

```bash
# 1. 下载 Clash Verge Rev
wget https://github.com/clash-verge-rev/clash-verge-rev/releases/latest/download/clash-verge-rev_1.7.7_amd64.deb

# 如果 wget 太慢，用 U 盘从 Windows 拷过来
```

```bash
# 2. 安装
sudo dpkg -i clash-verge-rev_1.7.7_amd64.deb
sudo apt install -f   # 补依赖
```

**配置：**
- 打开 Clash Verge（应用菜单里找）
- 导入你的 EEVPN 订阅链接
- 开启系统代理
- 终端设代理环境变量（可写入 `~/.bashrc`）：

```bash
echo 'export http_proxy=http://127.0.0.1:7897
export https_proxy=http://127.0.0.1:7897' >> ~/.bashrc
source ~/.bashrc
```

---

## 第三步：安装 Hermes Agent

```bash
# 一条命令安装
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
```

安装完成后，执行新手引导：

```bash
hermes setup
```

引导过程中需要你：
1. 选择默认模型 → 选 **DeepSeek**
2. 输入 **DeepSeek API Key**（和 ThinkPad 上用同一个）
3. 语言选择 → 按需选择

---

## 第四步：注册第二个钉钉机器人

在 ThinkPad 或 MacBook 的浏览器上操作：

### 4.1 新建应用
1. 打开 https://open-dev.dingtalk.com
2. 扫码登录
3. **应用开发 → 新增应用**
   - 名称：`mac-小钉hermes`
   - 类型：**企业内部应用**
4. 创建后记下 **AppKey** 和 **AppSecret**

### 4.2 配置机器人
1. 应用详情 → **机器人与消息推送** → 启用
2. 消息接收模式选择 **Stream 模式**
3. 无需填写消息接收 URL
4. 添加机器人权限：申请 **企业内机器人发送消息**

### 4.3 添加可见范围
1. 应用详情 → **版本管理与发布** → 可见范围
2. 搜索你的钉钉名字，添加进去

### 4.4 配置 Hermes 钉钉连接

编辑 `~/.hermes/.env`，添加以下内容：

```bash
DINGTALK_CLIENT_ID=<刚记下的 AppKey>
DINGTALK_CLIENT_SECRET=<刚记下的 AppSecret>
# 钉钉 Home Channel ID（和 ThinkPad 上同一个）
DINGTALK_HOME_CHANNEL=cid8PcyxzfwlH2pPJ+t82eTPwjQYu95oVdsGsC8K6k9kHI=
```

### 4.5 启动并验证

```bash
hermes gateway start
```

启动成功后，你会收到一条来自 **mac-小钉hermes** 的消息。从此在钉钉消息列表里就有两个独立的会话了。

---

## 第五步：安装 Tether 通信桥

> Tether 让两个 Hermes 实例能互相发送消息、委托任务。

### 5.1 在 MacBook 上

```bash
# 安装依赖
pip install flask requests

# 下载 Tether 服务端脚本（从 ThinkPad 获取）
# 或者手动创建以下文件：
```

创建 `/usr/local/bin/tether-server`：

```python
#!/usr/bin/env python3
"""Tether server — Hermes 实例间通信桥"""
from flask import Flask, request, jsonify
import subprocess, uuid, threading, time, json, os, logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s [TETHER] %(message)s')
app = Flask(__name__)

# 配置（放到环境变量或配置文件）
PEER_NAME = "mac-小钉hermes"          # 对方视角看到的我
PEER_URL = "http://100.102.54.90:9001"  # ThinkPad 的 Tether 地址
AUTH_TOKEN = os.environ.get("TETHER_TOKEN", "tether-tp-mac-2026")

# 当前任务状态
current_task = {"status": "idle", "description": None, "started_at": None}
task_results = {}  # task_id -> result

@app.route('/status', methods=['GET'])
def status():
    return jsonify({
        "name": PEER_NAME,
        "status": current_task["status"],
        "current_task": current_task["description"],
        "uptime": time.time() - start_time
    })

@app.route('/task', methods=['POST'])
def receive_task():
    data = request.json
    if not data or 'payload' not in data:
        return jsonify({"error": "invalid task"}), 400
    
    task_id = str(uuid.uuid4())
    cmd = data['payload'].get('command', '')
    workdir = data['payload'].get('workdir', os.environ.get('HOME', '/'))
    description = data.get('description', cmd[:50])
    
    current_task["status"] = "busy"
    current_task["description"] = description
    current_task["started_at"] = time.time()
    
    def run_task(tid, command, wd, desc, cb_url):
        try:
            result = subprocess.run(command, shell=True, cwd=wd,
                                  capture_output=True, text=True, timeout=600)
            res = {
                "stdout": result.stdout[-5000:],
                "stderr": result.stderr[-2000:],
                "exit_code": result.returncode
            }
        except subprocess.TimeoutExpired:
            res = {"stdout": "", "stderr": "timed out", "exit_code": -1}
        except Exception as e:
            res = {"stdout": "", "stderr": str(e), "exit_code": -1}
        
        task_results[tid] = res
        current_task["status"] = "idle"
        current_task["description"] = None
        current_task["started_at"] = None
        
        # 回调通知发起方
        if cb_url:
            try:
                import requests
                requests.post(cb_url + "/callback", json={
                    "task_id": tid,
                    "status": "completed" if res["exit_code"] == 0 else "failed",
                    "result": res
                }, timeout=10, headers={"X-Tether-Token": AUTH_TOKEN})
            except:
                pass
    
    cb_url = data.get('callback_url')
    threading.Thread(target=run_task, args=(task_id, cmd, workdir, description, cb_url), daemon=True).start()
    
    return jsonify({"status": "accepted", "task_id": task_id})

@app.route('/callback', methods=['POST'])
def receive_callback():
    data = request.json
    logging.info(f"Task callback: {data.get('task_id')} -> {data.get('status')}")
    # 将结果写入临时文件，供 Hermes 读取
    with open(f"/tmp/tether_callback_{data.get('task_id')}.json", 'w') as f:
        json.dump(data, f)
    return jsonify({"ok": True})

@app.route('/message', methods=['POST'])
def receive_message():
    data = request.json
    msg = data.get('message', '')
    sender = data.get('from', 'unknown')
    logging.info(f"Message from {sender}: {msg[:100]}")
    # 写到日志文件，Hermes 可以轮询读取
    with open("/tmp/tether_messages.log", "a") as f:
        f.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {sender}: {msg}\n")
    return jsonify({"ok": True})

if __name__ == '__main__':
    start_time = time.time()
    app.run(host='100.101.x.x', port=9001)  # 替换为 MacBook 的 Tailscale IP
```

> ⚠️ **替换上面 `host` 一行为 MacBook 实际的 Tailscale IP**

赋予执行权限：

```bash
chmod +x /usr/local/bin/tether-server
```

### 5.2 在 ThinkPad 上同样操作

ThinkPad 上也创建一份 `tether-server`（将 `PEER_URL` 指向 MacBook 的 Tailscale IP，`PEER_NAME` 改为 `"tp-小钉hermes"`）。

### 5.3 配置 systemd 自启动

```bash
sudo vim /etc/systemd/system/tether.service
```

内容：

```ini
[Unit]
Description=Tether — Hermes instance bridge
After=network-online.target tailscaled.service
Wants=tailscaled.service

[Service]
ExecStart=/usr/local/bin/tether-server
Restart=always
RestartSec=5
User=zzsky
Environment=TETHER_TOKEN=tether-tp-mac-2026

[Install]
WantedBy=multi-user.target
```

启用并启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now tether
```

### 5.4 测试连通

分别在两台机器上：

```bash
# 查自己状态
curl http://127.0.0.1:9001/status

# 查对方状态（从 ThinkPad 查 MacBook）
curl http://100.101.x.x:9001/status
```

---

## 使用方式

部署完成后，你可以：

1. **分别私聊两个助手**
   - 钉钉里找 **tp-小钉hermes** → ThinkPad
   - 钉钉里找 **mac-小钉hermes** → MacBook

2. **让 MacBook 执行任务**
   - 对 tp 说："让 mac 跑一下这个训练脚本"
   - tp 自动通过 Tether 委托给 mac

3. **两个助手互相通信**
   - mac 任务跑完了，自动通知 tp
   - tp 把结果转发给你

---

## 后续注意事项

- **DeepSeek API Key**：两个实例共享同一个 key，计费按总用量算
- **Tether 安全**：只在 Tailscale 内网通信，默认不对外暴露
- **断电重连**：MacBook 重启后 Tailscale 和 Tether 都会自动恢复
- **日志查看**：`journalctl -u tether -f`
