# AgentMesh Gateway

This is the AgentMesh Gateway (Fastify HTTP + Web UI + runner control WS).

## 推荐安全模型

优先用 Tailscale 暴露到内网，不要直接公网裸奔。
如果你必须走公网，你要自己做 TLS 终止、WAF、限流等。

## 配置文件

Gateway 读取 `data/config.json`（可用环境变量 `AGENTMESH_CONFIG_FILE` 覆盖路径）。

## Web 登录（用户名 + 密码 + 动态码）

首次启动需要先初始化两步验证：
访问 `GET /setup`，扫码后输入 6 位动态码确认。
确认成功后会把 `config.json` 里的 `web.totp.provisioned` 置为 true，并锁死初始化入口。

随后登录页会要求：用户名 + 密码 + 6 位动态码。

## Runner enrollment

Runner 的 register 接口已禁用，只允许 enroll。
通过 Gateway UI/API 签发 enroll code，然后 runner 端用 `AGENTMESH_ENROLL_CODE` 加入。
