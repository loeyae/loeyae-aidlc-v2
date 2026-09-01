# 前端编码规范

### 技术栈详情

| 类别 | 技术 | 版本 |
|------|------|------|
| 框架 | Vue + TypeScript | 3.x / 5.x |
| 构建 | Vite | 5.x |
| 组件库 | uview-plus | 3.x |
| 图标 | zui-svg-icon | - |
| 状态 | Pinia | 3.0.2 |
| 路由 | @gowiny/uni-router | 1.0.15 |
| 国际化 | Vue I18n | 11.x |
| 样式 | Sass | - |
| 日期处理 | dayjs | 1.11.19 |
| 分页 | z-paging | 2.x |

## 官方技术文档

- uview-plus：[文档](https://uiadmin.net/uview-plus/)
- pinia：[文档](https://pinia.vuejs.org/)
- z-paging: [文档](https://z-paging.zxlee.cn/start/intro.html)
- zui-svg-icon: [文档](https://ext.dcloud.net.cn/plugin?name=zui-svg-icon)
- @gowiny/uni-router：[文档](https://www.npmjs.com/package/@gowiny/uni-router)
- @uni-helper/vite-plugin-uni-pages：[文档](https://www.npmjs.com/package/@uni-helper/vite-plugin-uni-pages)
- dayjs：[文档](https://day.js.org/)
- vue-i18n：[文档](https://vue-i18n.intlify.dev/)
- svgo：[文档](https://github.com/svg/svgo)


## 前端规范

### 目录结构规范

```
├── api/              # API 请求模块
├── assets/           # 静态资源（SVG图标等）
├── components/       # 公共组件
├── config/           # 配置文件
├── locales/          # 国际化语言包
├── mixin/            # Vue mixin
├── pages/            # 主包页面
├── pages_xxx/        # 子包页面
├── router/           # 路由配置
├── static/           # 静态文件
├── store/            # Pinia 状态管理
├── uni_modules/      # UniApp 插件
└── utils/            # 工具函数
```

### 新增页面建议

所有项目文件都以 `index.vue` 作为入口文件，不建议使用其他文件名，并且一个文件夹下只允许有一个入口文件。

```
/pages
  /index
    index.vue
    ……
```

### 小程序分包建议

公共代码都会被编译到主包下。开发过程中主包只保留最基本模块，不建议再在主包下新增任何页面。

**主包示例：**
主包 用户加载全局 公共非业务的页面。

```
/pages          // 主包
  /load         // 加载loading页
  /index        // 首页
  /login        // 登录
  /webview      // webview 页面
  /uploadWebview // uploadWebview app上传文件页面
  /agreement    // 协议页面
```

**子包命名建议：`pages_【业务模块】`**
子包 用户加载业务模块的页面。
```
/pages_user     // 分包
  /mine         // 我的、个人中心
  /resetPass    // 修改密码
  ……
```

### 路由说明

使用 `@gowiny/uni-router` 来管理路由，可以在 `/pages.json` 中对路由的权限进行配置。

**示例：**
```json
{
  "path": "pages/index/index",
  "meta": {
    "needLogin": false
  },
  "style": {
    "navigationBarTitleText": "首页",
    "navigationStyle": "custom"
  }
}
```

### uview-plus

使用 `uview-plus` 组件库，建议使用 `uview-plus` 提供的 `u-` 前缀来命名组件，例如 `u-button`、`u-icon` 等。

注意事项：
- Upload APP不兼容
- Table2 [element] 不可用
- NoNetwork 不可用
- Tree 树形组件 不可用
- Link 超链接 不可用

### z-paging(分页组件)

使用 `z-paging` 实现下拉刷新和上拉加载功能。

**基本使用示例：**
```vue
<template>
  <z-paging ref="paging" use-page-scroll v-model="dataList" @query="queryList">
    <template #top>
      <u-navbar title="列表" :placeholder="true" :autoBack="true" />
    </template>
    <view class="container">
      <view
        v-for="item in dataList"
        :key="item.id"
        style="margin: 12px; padding: 16px; background: #fff;"
      >
        <view style="font-size: 22px; font-weight: bold">{{ item.id || '' }}</view>
        <view style="font-size: 18px">{{ item.name || '' }}</view>
      </view>
    </view>
  </z-paging>
</template>

<script lang="ts" setup>
import { ref } from 'vue'
import useZPaging from '@/uni_modules/z-paging/components/z-paging/js/hooks/useZPaging.js'
import { getListData } from '@/api/demo'

const paging = ref()
const dataList = ref<any>([])

useZPaging(paging)

const queryList = async (page: number, size: number) => {
  try {
    const params = { p: page, s: size }
    const res: any = await getListData(params)
    paging.value.complete(res.data?.rows || [])
  } catch {
    paging.value.complete([])
  }
}
</script>
```

**关键属性说明：**
| 属性 | 说明 | 默认值 |
| --- | --- | --- |
| `use-page-scroll` | 是否使用页面滚动模式 | false |
| `v-model` | 绑定数据列表 | - |
| `@query` | 分页查询回调方法 | - |

**常用方法：**
| 方法 | 说明 |
| --- | --- |
| `complete(data)` | 完成请求，传入数据列表 |
| `reload()` | 重新加载第一页 |
| `loadMore()` | 加载下一页 |

### iconFont(自定义图标支持)

使用 `zui-svg-icon` 组件来管理项目中的自定义图标。

**配置说明**

SVG图标位置：`/icons/svg/`

```bash
# 1、安装必要依赖
npm i svgo@latest

# 2、运行图标库生成脚本
npm run svgicon
```

**使用说明**
```vue
<zui-svg-icon width="100px" icon="bug" color="#FF0000" />
```

### 全局方法

**vue3使用：**
```vue
<script setup lang="ts">
import { getCurrentInstance } from 'vue'
const { proxy } = getCurrentInstance()!
proxy.$richTextFormat(html)
</script>
```

#### $richTextFormat(html)

用于处理富文本 rich-text 中上传图片宽度过大导致超出手机屏幕宽度带来的问题。

#### $getDictDatas(dictCode)

获取指定code字典的集合（数组）

#### $getDictData(dict, value)

获取指定字典 value对象 (json)

#### $getDictDataLabel(dictType, value)

获取指定字典value的label值（字符串）

### 组件说明

#### @/components/TabBar

TabBar 二次封装 u-tabbar 组件。

```vue
<template>
  <TabBar current="2" />
</template>

<script setup>
import TabBar from '@/components/TabBar/index.vue'
</script>
```

#### @/components/upload

upload 封装 上传组件，包含上传图片 和 上传文件。

```js
import FileUpload from '@/components/upload/FileUpload.vue'
import ImageUpload from '@/components/upload/ImageUpload.vue'
```

---

### 命名规范

| 类型 | 规范 | 示例 |
| --- | --- | --- |
| 文件/目录 | kebab-case | `user-info`, `login-page` |
| 组件名 | PascalCase | `Login.vue`, `UserProfile.vue` |
| 函数/方法 | camelCase | `getUserInfo`, `handleSubmit` |
| 变量/属性 | camelCase | `userName`, `isLoading` |
| 常量 | UPPER_CASE_SNAKE_CASE | `MAX_SIZE`, `API_BASE_URL` |
| Pinia Store | camelCase | `useUserStore`, `useAppStore` |
| 枚举 | PascalCase | `LoginStateEnum`, `UserStatus` |

### 代码规范

#### JavaScript/TypeScript

- 使用 ES6+ 语法
- 优先使用 `const`，需要重新赋值时使用 `let`，避免使用 `var`
- 箭头函数优先于普通函数
- 使用模板字符串代替字符串拼接
- 函数参数尽量不超过 3 个
- 类型定义使用 `interface` 而非 `type`（除非需要联合类型）

**示例：**
```typescript
// 推荐
const getUserInfo = async (id: string): Promise<UserInfo> => {
  const response = await request({ url: `/api/user/${id}` })
  return response.data
}

// 接口定义
interface UserInfo {
  id: string
  name: string
  avatar?: string
}
```

#### Vue 组件

- 使用 `<script setup>` 语法糖
- 模板中使用 2 空格缩进
- 组件属性使用 kebab-case
- 事件名使用 kebab-case
- props 使用 `defineProps` 定义，带有类型和默认值

**示例：**
```vue
<template>
  <view class="user-card">
    <u-avatar :src="user.avatar" />
    <text class="user-name">{{ userName }}</text>
    <u-button @click="handleClick">操作</u-button>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  user: UserInfo
}>()

const emit = defineEmits<{
  (e: 'click', id: string): void
}>()

const userName = computed(() => props.user.name || '未知')

const handleClick = () => {
  emit('click', props.user.id)
}
</script>
```

#### SCSS 样式

- 使用 2 空格缩进
- 属性按字母顺序排列
- 使用 `$` 定义变量
- 使用 `@mixin` 定义可复用样式
- 避免使用 `!important`

**示例：**
```scss
$primary-color: #1989fa;
$font-size-sm: 24upx;

.user-card {
  padding: 20upx;
  background: #fff;
  border-radius: 12upx;

  .user-name {
    font-size: $font-size-sm;
    color: $primary-color;
  }
}
```

### API 请求规范

- API 方法统一放在 `/api` 目录，按模块组织
- 使用 `request` 工具函数封装
- 方法名使用动词开头：`get`, `list`, `create`, `update`, `delete`
- 错误处理使用 try-catch-finally

**API 定义示例：**
```typescript
// api/login/index.ts
import request from '@/utils/request'
import type { UserVO, LoginParams } from './types'

export const LoginApi = {
  login: (params: LoginParams) => 
    request.post({ url: '/api/auth/login', data: params }),
  
  getUserProfile: () => 
    request.get({ url: '/api/user/profile' }),
  
  logout: () => 
    request.post({ url: '/api/auth/logout' })
}
```

**错误处理示例：**
```typescript
const handleLogin = async () => {
  loading.value = true
  try {
    const data = await LoginApi.login(formData.value)
    userStore.setUserInfo(data.user)
    uni.switchTab({ url: '/pages/index/index' })
  } catch (error) {
    uni.showToast({ title: '登录失败', icon: 'none' })
  } finally {
    loading.value = false
  }
}
```

### Git 提交规范

使用 Angular 风格的 commit message：

```
<type>(<scope>): <subject>
<BLANK LINE>
<body>
<BLANK LINE>
<footer>
```

**Type 类型：**
- `feat`: 新增功能
- `fix`: 修复 bug
- `docs`: 文档更新
- `style`: 代码格式（不影响代码运行）
- `refactor`: 重构（既不新增功能，也不是修复 bug）
- `test`: 测试相关
- `chore`: 构建/工具类更新

**示例：**
```
feat(user): 添加用户登录功能

- 实现账号密码登录
- 实现短信验证码登录
- 添加登录状态管理

Closes #123
```

### 国际化规范

#### 翻译规则

1. 所有翻译必须定义在 `locales` 目录下
2. 通用翻译必须定义在 `common` 对象中，例如：`login`、`logout`、`confirm` 等
3. 业务模块根据目录菜单定义翻译对象

#### 定义翻译

```typescript
// locales/zh.ts
export default {
  common: {
    login: '登录',
    logout: '退出登录',
    confirm: '确认',
    cancel: '取消',
    delete: '删除',
    search: '搜索',
    noData: '暂无数据'
  },
  user: {
    title: '个人中心',
    name: '用户名',
    mobile: '手机号'
  }
}
```

#### 使用翻译

```vue
<template>
  <view>{{ t('common.login') }}</view>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
</script>
```

### 组件提取规则

根据组件使用频率，同一组件使用频率 ≥ 2次，需要提取到 `@/components` 中。

#### 业务组件 `@/components/business/*`

与业务强相关的组件，如：`@/components/business/UserSelect`、`@/components/business/OrgTree` 等

#### 基础组件 `@/components/*`

与业务无关的组件，如：`@/components/TabBar`、`@/components/upload/ImageUpload` 等

### 检查清单

- [ ] pages 中所有代码样式必须私有化 `<style lang="scss" scoped>`
- [ ] pages 中所有 script 必有类型定义 `<script setup lang="ts">`
- [ ] 优先使用 `@/components` 中现有组件
- [ ] 遵循命名规范
- [ ] 使用 TypeScript 类型，避免 `any`
- [ ] API 调用正确处理错误（try-catch-finally）
- [ ] 国际化文本使用 `t()`
- [ ] 图片路径使用绝对路径
- [ ] 避免使用内联样式，使用 SCSS 变量

## 安装运行

```bash
# 安装依赖
npm install

```

## 检查清单

- [ ] views 中 所有代码样式必须私有化  `<style lang="scss" scoped>`
- [ ] views 中 所有script必有类型定义  `<script setup lang="ts">`
- [ ] 优先使用 `@/components` 中现有组件，其次使用 `uni_modules/uview-plus` 中组件
- [ ] 使用 TypeScript 类型
- [ ] 正确处理错误
- [ ] 国际化文本使用 `t()`

