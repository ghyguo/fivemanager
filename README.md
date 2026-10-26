# 四高慢病健康管理系统（一期演示工程）

根据《四高慢病健康管理系统_一期产品设计文档.md》搭建的院内部署演示工程，包含扫码问卷、MySQL 数据库、管理员机构/二维码管理和填写记录查询导出。

## 工程结构

```text
.
├── V1__init.sql                       # MySQL 8 建表及示例机构初始化脚本
├── V2__org_address.sql                # 现有数据库增加机构地址字段
├── docker-compose.yml                 # MySQL + API + Nginx 前端
├── backend/
│   ├── questionnaire/questionnaire-v1.json
│   └── src/                            # Node.js REST API
└── frontend/
    └── src/                            # Vue 3 移动端问卷与管理端
```

文档推荐的 Java/Spring Boot 可替换为其它后端实现，本演示工程采用 Node.js 22，便于快速启动和演示；REST 路径、问卷字段、MySQL 表结构与原始 SQL 保持一致。问卷内容以 `backend/questionnaire/questionnaire-v1.json` 为准。

## 使用 Docker Compose 启动

需要 Docker Engine / Docker Desktop 与 Docker Compose。首次启动会以 `V1__init.sql` 创建数据库表、默认机构，并构建前后端镜像。

```sh
cp .env.example .env
```

编辑 `.env`，至少设置 `MYSQL_ROOT_PASSWORD`、`MYSQL_PASSWORD`、`JWT_SECRET`、`QR_TOKEN_SECRET` 和 `ADMIN_INIT_PASSWORD`。请勿将真实密钥或密码提交到版本管理。分别为 `JWT_SECRET` 和 `QR_TOKEN_SECRET` 生成不同的随机值：

```sh
openssl rand -base64 48
```

每次命令生成一个值，将两个不同的输出分别填入 `.env`；两个密钥都至少需要 32 个字符。`QR_TOKEN_SECRET` 专门用于签发机构二维码令牌，不要在更换密钥后继续使用旧二维码。

本地运行可保留 `PUBLIC_BASE_URL=http://localhost`。公网部署时须把它设置为患者手机可访问的前端 HTTPS 地址，例如 `https://survey.example.com`；TLS 证书应由公网反向代理或负载均衡器终止。`RATE_LIMIT_PER_MINUTE_PER_IP` 默认是每个来源 IP 每分钟 600 次提交请求，可按压测结果调整，不能设置为无限制。

再启动服务：

```sh
docker compose up --build -d
docker compose ps
```

若后端日志提示 `JWT_SECRET must contain at least 32 characters` 或 `QR_TOKEN_SECRET must contain at least 32 characters`，请在 `.env` 配置满足要求的随机值后重启服务：

```sh
docker compose up -d
```

- 患者二维码首页：`http://localhost/`（各启用机构对应一个二维码）
- 患者问卷：扫描二维码后打开；二维码中的签名令牌绑定机构编码和问卷版本
- 管理后台：`http://localhost/admin`
- 初始管理员：`.env` 中的 `ADMIN_INIT_USERNAME` / `ADMIN_INIT_PASSWORD`
- 健康检查：`http://localhost/api/v1/health`

首次启动创建的机构名为“示例医院（请修改）”，可在管理后台编辑名称和地址。局域网/医院 Wi-Fi 演示前，将 `PUBLIC_BASE_URL` 设置为患者手机能访问的固定地址（例如 `http://10.0.0.8`），并重启服务。二维码首页会在地址为 localhost 时显示提醒。若修改二维码地址，已经印制的二维码需要重新下载和印制。
新版二维码使用签名参数 `qr`，旧版 `?org=机构编码` 二维码不能再用于填写；更新部署后，请从后台为每家机构重新下载并替换已印制的二维码。更换 `QR_TOKEN_SECRET` 或问卷版本后，也需要重新生成二维码。

患者提交不需要登录。服务端验证二维码签名后才确定机构，并以数据库中读取的机构编码和名称写入每条答卷。相同提交标识重试会返回原记录，不会覆盖或新增重复答卷。限流是每个后端实例内存中的每 IP 固定时间窗计数；多实例部署时总额度会按实例数累加。连接池当前保留 10 个连接、最多排队 100 个请求，并设置 10 秒连接建立超时；这些设置不是并发容量承诺，公网正式使用前应在隔离的测试数据库上按目标峰值压测。

MySQL 数据保存在 Docker 命名卷 `mysql_data`；初始化 SQL 只在该卷首次为空时执行。已有数据库增加机构地址字段时，请先备份，再通过 MySQL 客户端运行 `V2__org_address.sql`。

每日备份示例：`sh deploy/backup.sh`。默认写入 `backups/` 并清理 30 天前的同名备份；生产环境请将 `BACKUP_DIR` 指向单独的备份盘或院内备份服务器，并配置定时任务。

## 本机开发

要求 Node.js 22+、npm 和可访问的 MySQL 8.0。先创建数据库并执行根目录的 `V1__init.sql`，再启动 API：

```sh
cd backend
npm install
DB_HOST=127.0.0.1 DB_NAME=fourhigh_survey DB_USER=survey DB_PASSWORD=change_me \
JWT_SECRET=replace_with_a_random_secret_at_least_32_characters \
QR_TOKEN_SECRET=another_random_secret_at_least_32_characters \
ADMIN_INIT_USERNAME=admin ADMIN_INIT_PASSWORD=change_me_first_login \
PUBLIC_BASE_URL=http://localhost npm run dev
```

另开终端启动 Vue 开发服务：

```sh
cd frontend
npm install
npm run dev
```

开发服务默认运行在 `http://localhost:5173`，API 请求会代理到 `http://localhost:8080`。如未携带 `org` 参数，会显示可用机构列表。

问卷题目及选项按附件《问卷的具体内容2026.xlsx》更新；前端问卷版本为 v2，旧版本未完成的本地草稿不会覆盖新问卷。

## 数据与隐私

- 患者端无需登录，不接入微信授权或微信 JS-SDK。
- API 不输出姓名、手机号或问卷答案日志；管理端手机号列表默认脱敏，显示完整号码和登录行为记入 API 审计日志。
- 管理接口使用 JWT（8 小时）；管理员连续登录失败 5 次后锁定 10 分钟。
- 生产环境应使用强密码、固定且不可公开访问的 JWT 密钥、HTTPS、最小权限 MySQL 账号，并按医院要求备份和审定隐私告知文案。
- `PUBLIC_BASE_URL` 仅用于生成二维码，不会自动配置 DNS、HTTPS 或医院网络访问策略。

## 校验

```sh
cd backend && npm test
cd frontend && npm run build
```
# fivemanager
