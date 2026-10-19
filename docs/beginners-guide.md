# 零基础部署：让自己的 ChatGPT 查询麦当劳门店和报价

这份教程不要求你拥有 KuiNest，也不要求你写后端代码。你要准备自己的云服务器、域名、合法官方凭据，并亲自完成账号登录和授权。AI 可以解释和排错，不能代替你同意付费、提供密码或执行真实交易。

**首次目标是“查到真实门店、商品和预览报价”，不是下单。** 文中安装命令用于一台全新的 Ubuntu 24.04 x64 服务器；不要拿去覆盖已有网站。每个代码块也要逐条执行，遇到非零退出或报错就停在该步，让 AI 根据脱敏错误排查。

## 0. 先确认你具备哪些条件

**在哪里：自己的浏览器和 ChatGPT 网页。**

- 阅读 README 的“复制给 ChatGPT 的部署提示词”，把它和本仓库地址发给能联网阅读文档的 ChatGPT。无法联网时，提供 README 和本教程文本，不能让 AI 猜仓库内容。
- 确认账号/工作区界面允许添加自定义 MCP，并允许 OAuth；看不到入口时先问管理员或核对[OpenAI 官方说明](https://developers.openai.com/api/docs/guides/custom-mcp-server)。**购买套餐不等于必然拥有该权限。**
- 本人访问[麦当劳 AI 开放平台](https://open.mcd.cn/mcp)，确认能合法取得自己的官方 MCP Token。不要把 Token 发给 AI。
- 告诉 AI：使用电脑还是手机、有无服务器/域名、系统是什么、能接受的费用范围；不必提供密码、验证码或身份证件。

**成功标志：** 已确认能添加自定义 MCP，也能使用本人官方凭据，并选择了一个部署环境。缺少其中任一项时，先解决条件，不急着买服务器。

## 1. 服务器是什么，如何选择

服务器就是一台持续联网运行的小电脑。ChatGPT 要通过 HTTPS 找到这个网关；关掉自己电脑后服务也要在线，所以本教程使用云端 Linux 服务器。GitHub 只是放代码，不会替你持续运行后端；把仓库链接发给 AI 也不会自动安装服务。

| 方式 | 本项目情况 | 新手建议 |
|---|---|---|
| 云端 Ubuntu 24.04、x86_64 虚拟机 | 已有 Node/systemd/nginx 模板，本轮独立认证与协议在此环境做本地合成验证 | 推荐；普通单用户可先选约 2 核、2GB 内存、20GB 以上磁盘，实际按负载调整 |
| 已有 Linux 主机 | 可独立实例部署，但需检查端口和已有站点 | 请 AI 先核对，不能停止别人的服务 |
| 托管应用平台/免费容器 | 需持久磁盘、私有文件、稳定 HTTPS 和常驻进程，仓库没有已验证的一键模板 | 不作为本教程路线，免费休眠/临时磁盘可能丢状态 |
| 家里电脑加隧道 | 需自行解决在线时间、TLS、Cookie 和持久化 | 进阶方案；没有一键支持承诺 |

**在哪里：你选定的云服务商控制台。输入/选择：** 新建 Ubuntu 24.04 LTS、x86_64/amd64、带公网地址的实例。确认续费、流量、磁盘和备份收费后由本人付款；免费试用也要看额度、到期和自动续费。按平台要求准备安全登录方式，密钥留在本人设备。

费用可能包括服务器与流量、域名年费、可选备份/监控、你的 ChatGPT 订阅和实际餐品。HTTPS 可使用免费 Let's Encrypt 证书；源码本身按 MIT 免费提供，不需要 OpenAI API Key。本教程不承诺某家云永久免费，也不替你购买服务。

**成功标志：** 控制台显示实例运行中，你能打开它的浏览器终端。**失败排查：** 先用云控制台连接；不要反复尝试未知 SSH 用户名或分享私钥。

## 2. 域名、DNS 与网络入口

**在哪里：域名服务商的 DNS 控制台。** 域名是好记的服务器地址，DNS 将它指到服务器，HTTPS 证书让浏览器确认身份并加密。可以给已有域名新增 `coffee` 子域名，无需再买一个域名。

新增一条 A 记录：主机名 `coffee`，值为你的服务器公网 IPv4。没配置 IPv6 就不要添加 AAAA。本文用 `mcd.example.com` 占位，**后续所有命令、配置都要替换成自己的完整域名**，不要真的申请 example.com 的证书。初次先用直接 DNS 解析，避免代理/CDN缓存或访问挑战干扰 OAuth。

**在哪里：云安全组。** 入站开放 HTTP 80、HTTPS 443；SSH 22 仅按本人管理需要限制来源。不要向公网开放内部服务端口 4318。服务器还需能出站访问 GitHub、npm、Node 官方源和麦当劳官方 HTTPS。

**成功标志：** 稍后在服务器执行 `dig +short mcd.example.com A`，结果与控制台公网地址相同。**失败排查：** 检查记录主机名、DNS 服务商、旧 AAAA 和解析缓存；不要把解析失败误判为程序错误。

## 3. 在服务器准备操作环境

**在哪里：云服务器浏览器终端。以下均为 Linux 命令，不是在自己 Windows PowerShell 里执行。**

```sh
whoami
uname -m
cat /etc/os-release
```

应该是 Ubuntu 24.04、`x86_64`，优先使用有 sudo 权限的普通账户。若当前是 root，让 AI 先引导你用 `adduser mcp-builder`、`usermod -aG sudo mcp-builder`、`su - mcp-builder` 创建并切换普通账户；新系统密码在终端本人输入。后续只有明确的系统安装步骤用 sudo，npm 安装不使用 sudo。

```sh
sudo apt-get update
sudo apt-get install -y git curl xz-utils ca-certificates nginx dnsutils nano
```

**成功标志：** 安装结束返回命令提示符，`git --version` 可用。**失败排查：** sudo 权限、系统版本、软件源和剩余磁盘；ARM 主机不能继续使用下文 x64 包，请 AI 按匹配架构和模板路径调整。

## 4. 安装项目指定的 Node.js 和 npm

Node.js 用来运行后端；npm 用来安装代码需要的包。本教程固定使用 Node 24.20.0 及随附 npm 11.19.0（仓库要求 Node 24.20+、24.x），不能直接用系统可能附带的旧版 Node，也不要随意升到 25。

**在哪里：服务器普通用户终端。**

```sh
mkdir -p ~/mcp-downloads
cd ~/mcp-downloads
curl -fLO https://nodejs.org/dist/v24.20.0/node-v24.20.0-linux-x64.tar.xz
curl -fLO https://nodejs.org/dist/v24.20.0/SHASUMS256.txt
sha256sum --ignore-missing --check SHASUMS256.txt
```

**成功标志：** 对刚下载的 `node-v24.20.0-linux-x64.tar.xz` 显示 `OK`。下载或校验失败必须先解决，不能跳过校验。接下来确认 `/opt/node-v24.20.0-linux-x64` 不存在；若已存在，先检查其中 Node 版本，不要覆盖。

```sh
sudo tar -xJf node-v24.20.0-linux-x64.tar.xz -C /opt
export PATH=/opt/node-v24.20.0-linux-x64/bin:$PATH
node --version
npm --version
```

应分别看到 `v24.20.0`、`11.19.0`。每次重新打开终端都先执行上述 `export PATH=...`；systemd 使用绝对路径，不依赖它。来源为 [Node 官方发行目录](https://nodejs.org/dist/v24.20.0/)。若看到别的版本，运行 `command -v node` 排查路径，不要改仓库版本限制掩盖问题。

## 5. 下载代码并做离线验证

**在哪里：服务器普通用户终端。**

```sh
cd ~
git clone https://github.com/AriaEternity/xiaokui-mcd-mcp.git
cd ~/xiaokui-mcd-mcp
npm ci
npm test
```

**成功标志：** 构建与离线测试通过，出现 `dist/main.js`。测试只使用虚构店铺/商品和回环网络；**通过测试不代表能查询真实麦当劳账户，更不代表已下单**。本项目使用 better-sqlite3 原生依赖；当前锁定的13.0.3通过npm包的prebuilds附带Linux平台构件，Ubuntu24.04 x64按上述npm ci安装即可，不需要额外找GitHub二进制或默认安装编译器。应在目标Linux安装，不复制Windows的node_modules。若构件缺失或加载失败，先按FAQ检查Node、架构、libc和锁文件；原生重编译是进阶排查，可能需要build-essential/python3及上游构建流程，不能认为反复npm ci一定会自动编译。

**失败排查：** `EBADENGINE` 查 Node/npm；`npm ci` 网络错误查官方 npm 出站；不能删锁文件改用任意依赖版本；测试失败先给 AI 看脱敏的错误名，不要反复重跑。目录已存在时先 `git status` 核对，不能再次覆盖克隆。

## 6. 建立独立程序目录和服务用户

**在哪里：仍在服务器 `~/xiaokui-mcd-mcp`。仅用于首次安装。**

```sh
sudo useradd --system --home-dir /var/lib/xiaokui-mcd --shell /usr/sbin/nologin xiaokui-mcd
sudo install -d -m 0700 -o xiaokui-mcd -g xiaokui-mcd /var/lib/xiaokui-mcd
sudo install -d -m 0700 -o root -g root /etc/xiaokui-mcd
sudo install -d -m 0755 /opt/xiaokui-mcd/releases
RELEASE=/opt/xiaokui-mcd/releases/initial
test ! -e "$RELEASE"
```

最后一行成功时不输出内容；**若失败就停止，不执行下一块**。用户/目录已存在也先核对，不能用递归改权限或删除来“重来”。

```sh
sudo mkdir "${RELEASE:?请先设置本节RELEASE}"
sudo cp -R dist node_modules scripts deploy examples package.json package-lock.json LICENSE NOTICE.md "${RELEASE:?}/"
sudo chmod -R u=rwX,go=rX "${RELEASE:?}"
sudo ln -s "${RELEASE:?}" /opt/xiaokui-mcd/current
readlink -f /opt/xiaokui-mcd/current
```

**成功标志：** 最后一行指向 `/opt/xiaokui-mcd/releases/initial`。程序归 root 管理，服务用户只写自己的状态目录。`data/`、秘密、日志和 `.git` 没有复制进运行程序。权限错误先核对命令所在目录和目标，不要 `chmod 777`。

## 7. 初始化主人账户并保存官方麦当劳 Token

**在哪里：服务器交互终端。** 本站主人账号用于批准OAuth连接和逐笔订单，与麦当劳账号、ChatGPT账号不同。使用 npm run owner:init 对应的同一脚本，直接把主人文件写入 root 私有目录：

```sh
sudo env OWNER_FILE=/etc/xiaokui-mcd/owner.json /opt/node-v24.20.0-linux-x64/bin/node /opt/xiaokui-mcd/current/scripts/owner-init.mjs
```

用户名默认 owner；两次输入至少16字符的自设密码，屏幕不显示字符是正常的。脚本只保存随机身份、salt和scrypt哈希，生成0400文件，不接受命令行密码，不覆盖旧文件。成功提示“主人文件已创建”。请自己保管密码，不发给AI，也不上传owner.json。

**在哪里：本人浏览器。** 登录 [麦当劳官方平台](https://open.mcd.cn/mcp)，按官方要求取得本人Token并决定是否同意官方协议。不支持时先停止，仓库不提供共享Token或非官方获取办法。

回到自己的服务器终端，运行内置的隐藏输入工具，粘贴Token时不带Bearer前缀：

```sh
sudo env MCD_TOKEN_FILE=/etc/xiaokui-mcd/mcd-token /opt/node-v24.20.0-linux-x64/bin/node /opt/xiaokui-mcd/current/scripts/token-init.mjs
sudo stat -c '%F %a %U %G %h' /etc/xiaokui-mcd/owner.json /etc/xiaokui-mcd/mcd-token
```

**成功标志：** 两个常规文件均为400、root所有、链接数1。原始Token不显示，也不写入环境变量正文或聊天。文件已存在时工具拒绝覆盖；不能删掉主人配置“重新初始化”。**失败排查：** 确认使用交互终端、私有目录，密码两次一致，Token只含合法字符。不要cat文件验证。

## 8. 配置独立服务与开机启动

**在哪里：服务器终端。** 执行 sudo nano /etc/xiaokui-mcd/bridge.env，填写非秘密配置（替换自己的域名）：

```ini
PUBLIC_ORIGIN=https://mcd.example.com
DATA_ROOT=/var/lib/xiaokui-mcd
PORT=4318
MCP_OAUTH_ENABLED=true
MCD_MCP_ENABLED=true
MCD_ORDER_CREATE_ENABLED=false
```

nano用Ctrl+O、回车保存，Ctrl+X退出。PUBLIC_ORIGIN不带末尾斜杠或路径。独立版从受保护的owner.json取得真实主人标识，**无需填写MCD_OWNER_ID或OWNER_AUTH_ADAPTER**。systemd会通过LoadCredential为进程提供主人文件和独立Token。不要设置瑞幸的ENABLE_PREVIEW/ENABLE_ORDERS，这里没有那些开关。

```sh
cd ~/xiaokui-mcd-mcp
sudo install -m 0644 deploy/xiaokui-mcd.service.example /etc/systemd/system/xiaokui-mcd.service
sudo systemd-analyze verify /etc/systemd/system/xiaokui-mcd.service
sudo systemctl daemon-reload
sudo systemctl enable --now xiaokui-mcd.service
sudo systemctl is-active xiaokui-mcd.service
curl --fail http://127.0.0.1:4318/health/ready
```

**成功标志：** active和{"status":"ready"}。服务只监听回环；关闭终端或重启主机后，systemd继续运行并使用持久目录。**失败排查：** 查Node绝对路径、文件元数据、端口和本实例固定错误MCD_START_FAILED；不能打印凭据或放宽文件权限。无需编写Fastify宿主或认证模块，npm start现在进入真正的standalone。

## 9. 配置 HTTPS（先申请证书，再安装正式站点）

**在哪里：服务器终端。** 先创建一个仅供证书验证的 HTTP 站点，避免证书还不存在就安装含证书路径的模板。本文只适用于新子域名，已有同名站点先请 AI 核对。

```sh
sudo install -d -m 0755 /var/www/xiaokui-acme
sudo nano /etc/nginx/sites-available/xiaokui-mcd
```

填入下面内容（替换域名）：

```nginx
server {
    listen 80;
    server_name mcd.example.com;
    root /var/www/xiaokui-acme;
    location ^~ /.well-known/acme-challenge/ { try_files $uri =404; }
    location / { return 404; }
}
```

```sh
sudo ln -s /etc/nginx/sites-available/xiaokui-mcd /etc/nginx/sites-enabled/xiaokui-mcd
sudo nginx -t
sudo systemctl reload nginx
sudo snap install --classic certbot
sudo /snap/bin/certbot certonly --webroot -w /var/www/xiaokui-acme -d mcd.example.com
```

本人填写通知邮箱、阅读并决定是否同意证书服务条款。成功后证书在 `/etc/letsencrypt/live/自己的域名/`。失败先查 DNS、80 端口、旧 AAAA、代理和 nginx 配置，不能绕过证书校验。依据 [Ubuntu HTTPS 文档](https://ubuntu.com/server/docs/how-to/security/obtain-tls-certificates/)。

如果 `snap` 不存在，先在 Ubuntu 安装 `sudo apt-get install -y snapd`，核对 `snapd.socket` 与初始化状态后再继续。受管平台不支持 snap/systemd 时，不属于本教程验证路线，请 AI 按官方平台文档重新确认方案，不能用随机安装脚本替代。

保持上面的 80 站点供后续续期。在同一个站点文件末尾追加仓库 `deploy/nginx-site.conf.example` 的完整 HTTPS server 块，并把其中**域名和两条证书路径**都替换成自己的。然后：

```sh
cd ~/xiaokui-mcd-mcp
sudo install -m 0644 deploy/nginx.conf.example /etc/nginx/snippets/xiaokui-mcd.conf
sudo nginx -t
sudo systemctl reload nginx
curl --fail https://mcd.example.com/.well-known/oauth-authorization-server
curl -sS -o /dev/null -w '%{http_code}\n' https://mcd.example.com/api/mcd/orders/mcp
```

**成功标志：** 元数据包含你自己的 issuer，最后返回 `401`，代表匿名访问被正确拦截。根网址 404 正常，项目没有首页。网站必须是浏览器信任的 HTTPS；不能为 Secure Cookie 改用 HTTP。

设置证书更新后平滑加载 nginx（只在自己的新机器上）：

```sh
sudo install -d /etc/letsencrypt/renewal-hooks/deploy
sudo nano /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
```

写入两行 `#!/bin/sh` 和 `systemctl reload nginx`，保存后执行：

```sh
sudo chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
sudo systemctl status snap.certbot.renew.timer --no-pager
sudo /snap/bin/certbot renew --dry-run
```

应看到续期定时器 active、演练成功；失败先解决再长期使用。不要在安装网页证书时向 AI 提供私钥。

## 10. 在ChatGPT添加自己的麦当劳MCP

**在哪里：本人浏览器的ChatGPT网页。** 根据当前账号可见入口，新增自定义MCP，选择OAuth和预注册/静态客户端。必须先确认账号/工作区权限；源码地址不是可以直接安装的公共服务。依据 [OpenAI当前官方说明](https://developers.openai.com/api/docs/guides/custom-mcp-server)。

| 参数 | 此独立版的值（替换域名） |
|---|---|
| Server URL / OAuth Resource | https://mcd.example.com/api/mcd/orders/mcp |
| Client ID | xiaokui-chatgpt-mcd |
| Client Secret | 留空，公共客户端；不填官方Token |
| Scope | mcd:orders:create |
| Authorization URL | https://mcd.example.com/api/mcd/oauth/authorize |
| Token URL | https://mcd.example.com/api/mcd/oauth/token |
| PKCE / Token endpoint auth | S256 / none |
| Redirect URI | https://chatgpt.com/connector_platform_oauth_redirect |

注意/api/mcd/oauth与瑞幸的/oauth不同；部分字段由发现文档自动获得。只支持表中的预注册客户端，不填虚构的registration URL，不选DCR/CIMD或无认证/混合认证。稳定回调需与管理页实际值一致；不一致时先核对issuer元数据，不能放宽回调限制。认证背景见 [OpenAI认证文档](https://developers.openai.com/plugins/build/auth)。

本仓库目前只有这个麦当劳Scope，名称含create，**不代表已经批准任何订单**。首次服务配置的MCD_ORDER_CREATE_ENABLED=false仍在服务端阻止真实创建，不能仅依靠模型说“不下单”。

创建并安装后，首次使用跳转到自己的HTTPS网站，用第7步的owner和本站密码登录，核对权限并同意OAuth。不要在此输入麦当劳密码或Token，也不要让AI代点同意。**成功标志：** 连接完成，发现8个工具。**失败排查：** 没入口查账号权限；invalid_target/invalid_scope查URL、Client ID、Scope；登录循环查HTTPS、精确PUBLIC_ORIGIN和Cookie，不使用HTTP绕过Secure属性。

## 11. 先查询真实菜单与实际计价，不创建订单

**在哪里：ChatGPT，选择刚安装的麦当劳连接。** 可以这样说：

> 只用我的麦当劳连接，先询问我想查询的城市与公开商圈，按searchType=2、beType=1查询门店，让我选店。读取该店菜单和必要的套餐详情，串行查询避免并发过多。按我的数量、套餐配置和是否要餐具进行calculate-price。只展示真实报价和官方返回的取餐方式，不批准、创建或支付任何订单。

**成功标志：** query-nearby-stores返回真实店铺，query-meals和query-meal-detail可用，calculate-price有quoteId、实际应付和takeWayList。查询仅限即时到店orderType=1、beType=1，不传假定的经纬度/beCode，不套用外送参数。收藏查询失败时使用城市与关键词；MCD_BUSY时减少详情并发。

套餐子项、特制key和默认配置来自本次官方详情。菜单价格只是参考，最终金额以calculate-price为准。不能使用旧报价或模型猜测金额，优惠券有券才可核实抵扣。

需要检查确认页面时，从当次takeWayList选择官方code，调用prepare-order取得confirmationUrl。本人打开自己的受保护页面，登录后查看门店、完整套餐配置、数量、优惠和应付；**当前只验证页面和报价，不点击批准，也不创建订单**。这里不要求使用者购买餐品。

以后本人明确决定尝试首单时，再单独阅读README首单流程、[订单状态说明](order-status.md)和SECURITY.md；部署者显式开启MCD_ORDER_CREATE_ENABLED=true，重启本实例，仍需每一笔在网页核对批准。create-order仅接收intentId；本人通过当次官方payH5Url支付，再query-order核实。配餐/完成不等于独立支付核验，paymentStatus=unverified也不表示未付款。有效取餐信息来自同一官方订单，缺失就如实说明。OAuth、聊天里的确认、创建成功都不能当作已付款或已取餐。UNKNOWN时停建单、官方核实，禁止重试。

## 12. 持久化、更新和恢复

- /etc/xiaokui-mcd：主人哈希、官方Token和非秘密配置，仓库外root私有；不要上传。
- /var/lib/xiaokui-mcd/identity：网页登录会话数据库；Cookie值只存摘要，8小时过期，退出会撤销，重启后继续真实校验。
- /var/lib/xiaokui-mcd/oauth：OAuth摘要授权；/var/lib/xiaokui-mcd/mcd-orders：报价、订单、SUBMITTING/UNKNOWN和锁。不能为重来而删除。
- /opt/xiaokui-mcd/current：只读程序指针。更新和回滚看[部署说明](DEPLOYMENT.md)，保留现有身份、OAuth与订单数据，不把旧状态覆盖回来。
- 一致性备份应先停本实例，将必要配置/状态备份限制访问并加密，再启动；SQLite备份要完整处理WAL，不在运行中只复制主文件。备份不能公开。
- 同机两个项目使用不同域名、服务用户、目录和端口。若瑞幸已占4318，请让AI把麦当劳PORT改成4319，并同时调整nginx两处proxy_pass；不要停瑞幸。

卡住时按[FAQ](faq.md)排查，只向AI提供脱敏错误名、状态码和非秘密配置。密码、Token、Cookie、授权/确认/付款链接、数据库、订单号和私人地址留在本人环境。当前没有自动密码重置、换主人或UNKNOWN解锁功能，不通过删文件绕过。

## 验证范围与当前首单状态

截至2026-10-19，真实门店/菜单/套餐查询及官方计价已验证；原宿主用户报告已有真实创建、本人付款和收到餐品，两笔已有订单只读核实了中文完成状态及官方取餐字段。**公开standalone的真实交易闭环、本次状态修复上线后的ChatGPT回执仍未验收，官方独立支付证据仍不可用。** 独立入口、主人认证和安全边界使用合成账号/凭据/上游在本地验证，不把模拟订单或支付状态当作真实交易。详见[订单状态说明](order-status.md)。

本教程没有替你购买服务器、申请域名、接受官方协议或执行真实安装。新云环境的HTTPS、systemd凭据装载、ChatGPT账号能力和本人OAuth仍由你在自己环境验证；仓库不是免部署公共服务，也不保证所有地区、套餐或账号可用。
