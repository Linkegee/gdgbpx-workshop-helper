# 干部学院账号面板 · Firefox 登录测试版 0.1.0

这是独立 Firefox 扩展，不是油猴更新；不修改当前 v1.5.43 学习助手，不启动本地诊断桥。第一阶段只验证容器内登录。账号看课、已完成学时计算、达标停止和跨账号助手日志汇总尚未接入。

## 安装与本次验收

1. Firefox 地址栏打开 `about:debugging#/runtime/this-firefox`。
2. 点击“临时载入附加组件”，选择本目录 `manifest.json`。无需关闭已有学院页面，无需修改签名安全设置。
3. 点击工具栏扩展菜单里的“干部学院账号面板（测试版）”。
4. 先添加两个账号：可以绑定两个已有且不同的容器，也可以分别选择自动创建。不要把另一个账号正在使用的容器分配给新账号。
5. 点击“全部准备登录”。扩展只打开或复用绑定容器中的学院首页，不导航专题页和播放器。旧首页通过检查状态自动接入，无需主动刷新。
6. 各卡片填写本次密码和该卡片显示的验证码，再点击“提交已填验证码的账号”。使用协议按用户已确认的偏好默认勾选，在提交时同步到学院表单；取消面板勾选时不会代为勾选原页面。不会自动勾选“三天免登录”。
7. 登录后核对两个账号的真实姓名和容器。已经登录的容器直接显示现有账号供核对，不退出或切换其身份。测试版不凭已登录就自动开始学习。
8. 若未出现验证码或姓名，点卡片“检查状态”或“打开学院页”；然后点顶部“下载面板诊断”。密码、验证码和图片不会写入此诊断文件。

临时扩展在 Firefox 重启后会被移除，需要重新载入；此包未签名，不要通过普通“从文件安装附加组件”把 ZIP 当成正式安装包。正式持久安装需另行完成 Mozilla 签名，本次未提交签名或上架。

## 已实现

- 一账号一容器绑定，阻止重复账号和同容器绑定多个账号；移出面板不会删除容器或关闭页面。
- 集中准备登录页、逐账号或批量提交，失败互不阻断；同账号操作互斥，避免重复提交。
- 从实际容器页面已加载的验证码图片生成本地预览，不重新请求图像生成另一份验证码。验证码变化时拒绝旧提交。
- 通过网站自己的表单及按钮完成原登录流程，不复制 Cookie、不自行构造登录 API 请求。
- 提交前检查容器、标签页和学院首页地址；容器重定向或页面变化则停止传递凭据。
- 本地持久化账号、备注、容器及标签页映射；密码仅在面板输入框、一次消息传递及学院原表单中短暂存在，提交后清空，不保存到配置、日志或服务端。
- 首页姓名和累计学时读取是初步适配，真实登录后的页面结构尚待现场验收；未读取到的值显示待读取，已完成学时显示待接入。
- 有界面板操作诊断，最多100条，不等同于现有油猴播放诊断。后台重启会清空本次操作诊断，不影响已保存映射。

## 权限与数据

`contextualIdentities`：创建/查询容器；`cookies`：Firefox 指定 cookieStoreId 打开容器标签页所需，不调用 Cookie 读写接口；`tabs`：核对标签页所在容器和地址；`storage`：本地映射；站点权限仅 `https://gbpx.gd.gov.cn/*`，实际登录适配限制学院 index.aspx 顶层页。

Mozilla 数据声明包含 authenticationInfo，因为用户点击登录会将账号密码提交给学院。扩展没有分析服务、开发者服务器或本机网络监听服务，不把账号密码发往其他网站。容器使用 Firefox 原生接口，与 Multi-Account Containers 共用容器；该插件的“始终在某容器打开”规则可能重定向标签页，本扩展会在容器不符时阻止提交，不能宣称已完成真实多容器验收。

## 验证与后续

本地13项测试通过：多账号定向传递、容器变化拒绝、并发重复操作、验证码过期、协议偏好、既有登录保留、凭据清空、不可信消息拒绝、HTML内容安全渲染、旧标签接入等。Mozilla web-ext lint 零错误、零警告。模拟浏览器API/DOM测试不是Firefox现场通过；下一步必须由用户在真实Firefox载入后测试两账号登录、验证码刷新和实际姓名学时读取。

开发测试：

```
node --test firefox-control/tests/*.test.cjs
npm install --prefix .panel-test-runtime --no-save --package-lock=false jsdom
node --test firefox-control/tests/panel-dom.cjs
npx --yes web-ext lint --source-dir firefox-control --ignore-files "tests/**" --warnings-as-errors
```

已核对的公开资料（2026-10-11）：
- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Work_with_contextual_identities
- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/create
- https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/
- https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/
- https://gbpx.gd.gov.cn/gdceportal/index.aspx
