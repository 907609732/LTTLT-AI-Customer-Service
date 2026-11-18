# 设备授权注册回跳修复交接（2026-11-17）

> 历史说明（2026-11-17）：本文件的根因分析、补丁与验证记录是当时分支的证据，**不是**本轮 2026-11-18 主干整合的验证结果。本轮只重放其中的 redirect 补丁、测试与来源记录，未重跑本文件列出的 4 文件 6 项、网页 typecheck/lint、`prepare` 或网页构建；这些结论需由 Codex 复核后另派验证，不得引用为本轮证据。

## 状态

- 根因已确认并修复：登录页「注册」链接、注册页「登录」链接、注册完成返回登录页、注册页微信/OAuth 登录都丢弃 `redirect`，导致首次注册并登录后落到 `/dashboard`。
- 业务修改仅在 `server/patches.json`（固定上游精确锚点）与 `server/overlay/web/src/**`（回归测试）内；`patches.json` 与原有导入测试的实际 SHA256 同步更新 `server/source-files.json`，并更新 `server/PROVENANCE.md` 和本文档。
- 未修改 `server/.upstream` 维护源、服务端 Go 业务、版本号、锁文件、生产服务、凭据、运行实例；未提交、推送或部署。

## 根因与修复

设备授权页在未认证时执行：

```ts
throw redirect({ to: '/sign-in', search: { redirect: location.href } })
```

登录页本身已用 `sanitizeAuthRedirect` 保存并消费 `redirect`，但注册相关跳转没有继续传递：

1. `web/src/features/auth/sign-in/index.tsx` 的 `<Link to='/sign-up'>` 没有 `search={{ redirect }}`。
2. `web/src/routes/(auth)/sign-up.tsx` 没有 `validateSearch`，也未在已登录时使用 `redirect`；进入注册页后该参数被丢弃。
3. `web/src/features/auth/sign-up/index.tsx` 的「已有账号？登录」和 `<SignUpForm />` 未使用 `redirect`。
4. `web/src/features/auth/sign-up/components/sign-up-form.tsx` 注册成功后只调用 `redirectToLogin()`；微信/OAuth 登录也未传 `redirectTo`。
5. `web/src/features/auth/hooks/use-auth-redirect.ts` 的 `redirectToLogin` 固定只跳 `/sign-in`，不携带搜索参数。

修复后的完整链路：

```text
/lingtu/device?user_code=...
  -> /sign-in?redirect=%2Flingtu%2Fdevice%3Fuser_code%3D...
  -> /sign-up?redirect=%2Flingtu%2Fdevice%3Fuser_code%3D...
  -> 注册成功 -> /sign-in?redirect=%2Flingtu%2Fdevice%3Fuser_code%3D...
  -> 登录成功 -> /lingtu/device?user_code=...
```

安全边界：

- 注册路由的 `validateSearch` 只接收可选 `redirect: string`。
- 已登录用户打开注册页时，目标由既有 `sanitizeAuthRedirect(search.redirect, window.location.origin) ?? '/dashboard'` 决定；外部地址、协议相对地址、反斜杠和非法 origin 继续返回 `null`，不会转发到外部。
- `redirectToLogin` 在写入 `/sign-in` 前再次调用 `sanitizeAuthRedirect`，外部参数会变成 `undefined`。
- 未新增依赖、公开端点、允许列表或服务端鉴权分支。

## 精确补丁

`server/patches.json` 的实际 diff：

```diff
diff --git a/server/patches.json b/server/patches.json
index 9013291..4ee0627 100644
--- a/server/patches.json
+++ b/server/patches.json
@@ -382,12 +382,70 @@
     {
       "before": "placeholder={t('Enter password (8–128 characters)')}",
       "after": "placeholder={t('Enter password (15–128 characters)')}"
+    },
+    {
+      "before": "import { useStatus } from '@/hooks/use-status'\nimport { handleServerError } from '@/lib/handle-server-error'",
+      "after": "import type { AuthFormProps } from '@/features/auth/types'\nimport { useStatus } from '@/hooks/use-status'\nimport { handleServerError } from '@/lib/handle-server-error'"
+    },
+    {
+      "before": "export function SignUpForm({\n  className,\n  ...props\n}: React.HTMLAttributes<HTMLFormElement>) {",
+      "after": "export function SignUpForm({\n  className,\n  redirectTo,\n  ...props\n}: AuthFormProps) {"
+    },
+    {
+      "before": "        redirectToLogin()",
+      "after": "        redirectToLogin(redirectTo)"
+    },
+    {
+      "before": "if (await handleLoginResult(res.data)) {",
+      "after": "if (await handleLoginResult(res.data, redirectTo)) {"
+    },
+    {
+      "before": "          <OAuthProviders\n            status={status}\n            disabled={isLoading || (requiresLegalConsent && !agreedToLegal)}",
+      "after": "          <OAuthProviders\n            status={status}\n            redirectTo={redirectTo}\n            disabled={isLoading || (requiresLegalConsent && !agreedToLegal)}"
     }
   ],
   "web/src/features/auth/sign-in/index.tsx": [
     {
       "before": "          {!status?.self_use_mode_enabled &&\n            status?.register_enabled !== false && (",
       "after": "          {redirect === '/lingtu/admin' && (\n            <p className='text-muted-foreground text-left text-sm sm:text-base'>\n              {t('Sign in with the administrator username and password created during setup. No new registration or email verification is required.')}\n            </p>\n          )}\n          {redirect !== '/lingtu/admin' && !status?.self_use_mode_enabled &&\n            status?.register_enabled !== false && ("
+    },
+    {
+      "before": "                  to='/sign-up'\n                  className='hover:text-primary font-medium underline underline-offset-4'",
+      "after": "                  to='/sign-up'\n                  search={{ redirect }}\n                  className='hover:text-primary font-medium underline underline-offset-4'"
+    }
+  ],
+  "web/src/features/auth/sign-up/index.tsx": [
+    {
+      "before": "import { Link } from '@tanstack/react-router'",
+      "after": "import { Link, useSearch } from '@tanstack/react-router'"
+    },
+    {
+      "before": "  const { status } = useStatus()",
+      "after": "  const { status } = useStatus()\n  const { redirect } = useSearch({ from: '/(auth)/sign-up' })"
+    },
+    {
+      "before": "            <Link\n              to='/sign-in'\n              className='hover:text-primary font-medium underline underline-offset-4'",
+      "after": "            <Link\n              to='/sign-in'\n              search={{ redirect }}\n              className='hover:text-primary font-medium underline underline-offset-4'"
+    },
+    {
+      "before": "        <SignUpForm />",
+      "after": "        <SignUpForm redirectTo={redirect} />"
+    }
+  ],
+  "web/src/routes/(auth)/sign-up.tsx": [
+    {
+      "before": "import { createFileRoute, redirect } from '@tanstack/react-router'",
+      "after": "import { createFileRoute, redirect } from '@tanstack/react-router'\nimport { z } from 'zod'\n\nimport { sanitizeAuthRedirect } from '@/features/auth/lib/auth-redirect'"
+    },
+    {
+      "before": "export const Route = createFileRoute('/(auth)/sign-up')({\n  component: SignUp,\n  beforeLoad: async () => {\n    const { auth } = useAuthStore.getState()\n\n    // 如果已经有用户信息，说明已登录，注册页对其无意义，跳转到 dashboard\n    if (auth.user) {\n      throw redirect({ to: '/dashboard' })\n    }\n  },\n})",
+      "after": "const searchSchema = z.object({\n  redirect: z.string().optional(),\n})\n\nexport const Route = createFileRoute('/(auth)/sign-up')({\n  component: SignUp,\n  validateSearch: searchSchema,\n  beforeLoad: async ({ search }) => {\n    const { auth } = useAuthStore.getState()\n\n    // 已登录用户打开注册页时仍需回到原本要去的页面（例如设备授权），\n    // 但只允许经校验的同源路径，避免外部重定向。\n    if (auth.user) {\n      const target =\n        sanitizeAuthRedirect(search?.redirect, window.location.origin) ??\n        '/dashboard'\n      throw redirect({ href: target, replace: true })\n    }\n  },\n})"
+    }
+  ],
+  "web/src/features/auth/hooks/use-auth-redirect.ts": [
+    {
+      "before": "  const redirectToLogin = useCallback(() => {\n    void navigate({ to: '/sign-in', replace: true })\n  }, [navigate])",
+      "after": "  const redirectToLogin = useCallback(\n    (redirectTo?: string) => {\n      const redirect =\n        sanitizeAuthRedirect(redirectTo, window.location.origin) ?? undefined\n      void navigate({ to: '/sign-in', search: { redirect }, replace: true })\n    },\n    [navigate]\n  )"
     }
   ],
   "middleware/rate-limit.go": [
```

生成后关键代码（与 patch 的 `after` 一致）：

```tsx
// web/src/features/auth/sign-up/index.tsx
const { redirect } = useSearch({ from: '/(auth)/sign-up' })
<Link to='/sign-in' search={{ redirect }} ...>
<SignUpForm redirectTo={redirect} />
```

```tsx
// web/src/routes/(auth)/sign-up.tsx
const searchSchema = z.object({ redirect: z.string().optional() })
export const Route = createFileRoute('/(auth)/sign-up')({
  component: SignUp,
  validateSearch: searchSchema,
  beforeLoad: async ({ search }) => {
    const { auth } = useAuthStore.getState()
    if (auth.user) {
      const target = sanitizeAuthRedirect(search?.redirect, window.location.origin) ?? '/dashboard'
      throw redirect({ href: target, replace: true })
    }
  },
})
```

```ts
// web/src/features/auth/hooks/use-auth-redirect.ts
const redirectToLogin = useCallback(
  (redirectTo?: string) => {
    const redirect = sanitizeAuthRedirect(redirectTo, window.location.origin) ?? undefined
    void navigate({ to: '/sign-in', search: { redirect }, replace: true })
  },
  [navigate],
)
```

回归测试文件：

- 新增 `server/overlay/web/src/features/auth/sign-up/__tests__/redirect.test.tsx`：注册页的「登录」链接和 `SignUpForm` 必须收到设备授权目标。
- 新增 `server/overlay/web/src/features/auth/sign-up/components/__tests__/register-redirect.test.tsx`：填写注册表单并成功注册后，必须以原 `redirect` 返回登录页。
- 新增 `server/overlay/web/src/features/auth/hooks/__tests__/auth-redirect-navigation.test.ts`：内部设备目标被保留，外部目标被丢弃。
- 更新 `server/overlay/web/src/features/lingtu/admin-login-hint.test.tsx`：精确 `/lingtu/admin` 仍不显示注册入口；其他目标（含 `/lingtu/device?user_code=...`）的「注册」链接保留 `redirect`。
- `server/source-files.json`：更新原有导入测试 `admin-login-hint.test.tsx` 的实际 SHA256 为 `ac1ddfd82a3528916b03ccfb9e9ff9f9cca8f852211f5212e6a1ce287770265f`，`patches.json` 的实际 SHA256 为 `2cce598645bdcf4d5f27fc81cb0a0f12c5426c3bccf3788a5e5483477a56c6ab`；上游路径与原始摘要保留。三份新增自有测试不进入导入清单。

## 测试与退出结果

### 1. 修复前失败（先写测试）

在 `server/.upstream/web` 执行：

```powershell
bun run test src/features/lingtu/admin-login-hint.test.tsx `
  src/features/auth/sign-up/__tests__/redirect.test.tsx `
  src/features/auth/sign-up/components/__tests__/register-redirect.test.tsx `
  src/features/auth/hooks/__tests__/auth-redirect-navigation.test.ts --maxWorkers=1
```

结果：**4 文件失败/共 5 项失败，1 项通过；exit 1**。失败点分别为 `/sign-up` 未带 redirect、`/sign-in` 未带 redirect、`redirectToLogin` 未带 search、注册完成调用空参数、外部目标测试因缺少 search 不成立。证明测试能稳定复现原缺陷。

### 2. 修复后通过

同一命令结果：**4 文件 6 项全部通过，exit 0**。

```text
Test Files  4 passed (4)
Tests       6 passed (6)
```

### 3. 类型检查

```powershell
cd server/.upstream/web
bun run typecheck
```

结果：`✓ No type errors in 1,439 files across 2 projects`，**exit 0**。

### 4. Lint

对 5 个生成的生产文件和 4 个测试文件执行：

```powershell
bun x oxlint -c .oxlintrc.json `
  "src/features/auth/sign-in/index.tsx" `
  "src/features/auth/sign-up/index.tsx" `
  "src/routes/(auth)/sign-up.tsx" `
  "src/features/auth/hooks/use-auth-redirect.ts" `
  "src/features/auth/sign-up/components/sign-up-form.tsx" `
  "src/features/auth/sign-up/__tests__/redirect.test.tsx" `
  "src/features/auth/sign-up/components/__tests__/register-redirect.test.tsx" `
  "src/features/auth/hooks/__tests__/auth-redirect-navigation.test.ts" `
  "src/features/lingtu/admin-login-hint.test.tsx"
```

结果：**exit 0**。新增/更新的 4 个 overlay 测试另用 `oxfmt --check` 检查，结果 **exit 0**。固定上游补丁文件沿用既有未格式化风格；`server:verify` 不包含全量 format 检查，本轮未把上游生成文件重排成新格式，避免无意义的大 diff。

### 5. 准备、构建与准备一致性测试

```powershell
node server/scripts/prepare.mjs
node --test server/tests/preparation.test.mjs
cd server/.upstream/web
bun run build
```

结果：

- prepare：`Managed server prepared: ... @ 48a6c87f9e7757fdc58e5be9bcb4f8281ad0dfd0`，**exit 0**，全部精确锚点匹配。
- preparation test：**2 项通过，0 失败，exit 0**。
- 原生网页生产构建：**exit 0**，产物写入 `server/.upstream/web/dist`。

### 6. 未执行

- 未运行完整 `npm run server:verify`（会重新跑 Go 回归和 Linux 二进制构建）；本轮改动仅原生 Web 认证路由，已用准备测试、目标前端测试、类型检查、lint 和构建覆盖。
- 未启动/重启任何运行实例，未做浏览器手工点击验收，未部署生产服务。

## 未解决问题与边界

- 设备授权 → 登录 → 注册 → 登录 → 设备页的真实浏览器端到端验收仍需在隔离本机服务上手工完成；本轮没有启动运行实例。
- 「忘记密码」链接仍不携带 `redirect`，属于本次缺陷范围外的既有行为；本轮未扩大修改。
- `redirectToRegister` 仍不接受目标参数；当前流程未使用它，故未改动。
- 注册路由沿用了原有的内存 `auth.user` 判断，没有额外调用 `resolveAuthentication`；已登录访问设备页时设备路由会先通过既有 `resolveAuthentication` 判定，不会把有有效 Refresh Cookie 的用户送到注册页。
- 生产发布、版本号递增和安装包构建未在本任务执行。

## 验收步骤

1. 在项目根执行 `node server/scripts/prepare.mjs`，确认锚点无漂移。
2. 在 `server/.upstream/web` 执行本文件第 3 节的目标测试、`bun run typecheck`、第 4 节 lint 和 `bun run build`。
3. 启动隔离本机 HTTP 预览（不改生产），打开 `/lingtu/device?user_code=ABCD-EFGH`：
   - 未登录应跳到 `/sign-in?redirect=%2Flingtu%2Fdevice%3Fuser_code%3DABCD-EFGH`。
   - 点击「Sign up」，地址应保留 `redirect`。
   - 完成注册后应回到带同一 `redirect` 的 `/sign-in`。
   - 登录后应回到 `/lingtu/device?user_code=ABCD-EFGH`，而不是 `/dashboard`。
4. 在注册页点击「Already have an account? Sign in」，确认 `redirect` 保留。
5. 手工把 `redirect` 改为 `https://attacker.example/steal` 或 `//attacker.example`，确认登录/注册完成后回到 `/dashboard`，不会离开本站。
6. 已登录状态直接打开 `/sign-up?redirect=%2Flingtu%2Fdevice%3Fuser_code%3DABCD-EFGH`，确认直接回到设备页；换成外部地址确认回到 `/dashboard`。
