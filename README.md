# Supa Simple Socket

一个简单易用的WebSocket客户端工具，支持心跳机制、断点重连、事件订阅和文件传输功能。

## 特性

- 🔄 **自动重连** - 网络波动时自动重连，支持指数退避策略
- 💓 **心跳检测** - 保持连接活跃，支持自定义心跳消息
- 🔔 **事件驱动** - 丰富的事件系统，支持链式调用
- ⚡ **消息队列** - 连接未建立时自动队列消息
- 📁 **文件传输** - 支持分块发送大文件，提供进度回调
- 📊 **状态管理** - 完整的连接状态管理和状态变化通知
- 🔧 **易于配置** - 丰富的配置选项，支持运行时更新
- 📝 **调试日志** - 可选的调试日志，帮助排查问题
- 🛠️ **类型安全** - 完整的TypeScript类型定义
- 🔁 **兼容原生** - 兼容并增强原生WebSocket功能

## 安装

```bash
npm install supa-simple-socket
```

## 快速开始

```typescript
import SupaSocket from 'supa-simple-socket';

// 创建WebSocket实例
const socket = new SupaSocket({
  url: 'wss://echo.websocket.org',
  debug: true
});

// 监听消息
socket.on('message', (data) => {
  console.log('收到消息:', data);
});

// 监听连接状态
socket.on('open', () => {
  console.log('连接已建立');
  
  // 发送消息
  socket.send({ type: 'greeting', content: '你好，世界！' });
});

// 监听错误
socket.on('error', (error) => {
  console.error('连接错误:', error);
});

// 关闭连接
// socket.close();
```

## 进阶用法

### 1. 发送不同类型的消息

```typescript
// 发送JSON对象
socket.sendJson({ type: 'chat', message: '你好！', timestamp: Date.now() });

// 发送文本
socket.sendText('普通文本消息');

// 发送二进制数据
const buffer = new ArrayBuffer(8);
socket.sendBinary(buffer);

// 发送文件
const fileInput = document.querySelector<HTMLInputElement>('#fileInput');
if (fileInput?.files?.[0]) {
  socket.sendFile(fileInput.files[0], {
    onProgress: (progress) => {
      console.log(`上传进度: ${progress.toFixed(2)}%`);
    },
    chunkSize: 32 * 1024 // 设置块大小为32KB
  });
}
```

### 2. 使用事件系统

```typescript
// 使用链式调用添加多个事件监听器
socket
  .on('open', () => console.log('连接已打开'))
  .on('message', (data) => console.log('收到消息', data))
  .on('close', () => console.log('连接已关闭'))
  .on('error', (error) => console.error('发生错误', error))
  .on('reconnecting', (data) => {
    console.log(`正在尝试重连 (${data.attempt}/${data.limit})，延迟：${data.delay}ms`);
  })
  .on('statusChange', ({ newStateName, oldStateName }) => {
    console.log(`连接状态从 ${oldStateName} 变为 ${newStateName}`);
  });

// 一次性事件监听（触发一次后自动移除）
socket.once('message', (firstMessage) => {
  console.log('收到第一条消息后我不会再被调用:', firstMessage);
});

// 移除特定事件的所有监听器
socket.off('message');

// 检查是否有某个事件的监听器
if (socket.hasListeners('error')) {
  console.log('已注册错误处理器');
}

// 获取所有已注册的事件
console.log('已注册的事件:', socket.events);
```

### 3. 连接管理

```typescript
// 检查连接状态
if (socket.isConnected) {
  console.log('WebSocket已连接');
}

// 获取当前连接状态
console.log('当前状态:', socket.connectionStateName);

// 手动重连
socket.reconnect();

// 重置重连计数并重连
socket.reconnect(true);

// 检查连接并在需要时自动重连
socket.checkConnection();

// 禁用自动重连
socket.disableAutoReconnect();

// 重新启用自动重连
socket.enableAutoReconnect();

// 获取最后一次收到消息的时间
console.log('最后接收消息时间:', socket.lastReceivedTime);

// 获取距离最后一次收到消息的时间（毫秒）
console.log('消息静默时间:', socket.timeSinceLastMessage);

// 销毁实例并释放资源
socket.destroy();
```

### 4. 更新配置

```typescript
// 实例化后更新配置
socket.updateOptions({
  heartbeatInterval: 20000,
  reconnectLimit: 10,
  debug: true
});

// 获取当前配置
const currentOptions = socket.getOptions();
console.log('当前配置:', currentOptions);
```

## 配置选项

`SupaSocket` 构造函数接受以下配置选项：

| 选项               | 类型                | 默认值  | 说明                               |
|-------------------|---------------------|---------|-----------------------------------|
| url               | string              | -       | WebSocket服务器URL（必填）          |
| reconnectLimit    | number              | 5       | 最大重连次数                       |
| reconnectInterval | number              | 5000    | 重连初始间隔（毫秒）                |
| heartbeatInterval | number              | 30000   | 心跳发送间隔（毫秒）               |
| heartbeatTimeout  | number              | 5000    | 心跳超时时间（毫秒）               |
| autoReconnect     | boolean             | true    | 是否自动重连                       |
| debug             | boolean             | false   | 是否输出调试日志                   |
| protocols         | string \| string[]  | -       | WebSocket协议                      |
| binaryType        | BinaryType          | -       | 二进制数据类型                      |
| autoParseMessage  | boolean             | true    | 是否自动解析JSON消息               |
| maxReconnectDelay | number              | 30000   | 最大重连延迟（毫秒）               |
| retryOnError      | boolean             | true    | 错误时是否重试                     |
| connectionTimeout | number              | 10000   | 连接超时时间（毫秒）               |
| pingMessage       | any                 | { type: 'ping' } | 自定义心跳消息                   |
| pongMessage       | any                 | { type: 'pong' } | 自定义心跳响应消息               |
| onOpen            | (event) => void     | -       | 连接建立回调                       |
| onClose           | (event) => void     | -       | 连接关闭回调                       |
| onError           | (event) => void     | -       | 连接错误回调                       |
| onStatusChange    | (newState, oldState) => void | - | 状态变化回调                    |

## API参考

### 属性

- **connectionState**: 获取当前连接状态（枚举值）
- **connectionStateName**: 获取当前连接状态名称（字符串）
- **events**: 获取所有已注册的事件名称
- **lastReceivedTime**: 获取最后一次收到消息的时间
- **timeSinceLastMessage**: 获取自上次收到消息以来的毫秒数
- **isConnected**: 连接是否处于打开状态
- **currentReconnectAttempt**: 当前重连尝试次数

### 方法

#### 连接管理
- **reconnect(resetCount?: boolean)**: 手动触发重连
- **close(code?: number, reason?: string)**: 关闭连接
- **checkConnection()**: 检查连接状态并在需要时重连
- **updateOptions(options: Partial<SupaSocketOptions>)**: 更新配置选项
- **getOptions()**: 获取当前配置选项
- **enableAutoReconnect()**: 启用自动重连
- **disableAutoReconnect()**: 禁用自动重连
- **destroy()**: 销毁实例并释放资源

#### 消息发送
- **send(data: any)**: 发送消息（自动处理不同类型）
- **sendJson(data: object)**: 发送JSON对象
- **sendText(text: string)**: 发送文本消息
- **sendBinary(data: ArrayBuffer | Blob)**: 发送二进制数据
- **sendFile(file: File, options?: object)**: 发送文件，支持进度回调

#### 事件处理
- **on(event: string, callback: (data: any) => void)**: 添加事件监听器
- **off(event: string, callback?: Function)**: 移除事件监听器
- **once(event: string, callback: (data: any) => void)**: 添加一次性事件监听器
- **clearAllListeners()**: 清除所有事件监听器
- **hasListeners(event: string)**: 检查是否有特定事件的监听器

### 事件

- **open**: 连接建立时触发
- **message**: 收到消息时触发
- **close**: 连接关闭时触发
- **error**: 连接错误时触发
- **reconnecting**: 重连开始时触发，包含尝试次数和限制信息
- **reconnectFailed**: 重连失败（超过最大次数）时触发
- **heartbeatTimeout**: 心跳超时时触发
- **connectionTimeout**: 连接超时时触发
- **statusChange**: 连接状态变化时触发
- **file_progress**: 文件发送进度更新时触发
- **[其他]**: 如果收到的消息有`type`字段，也会触发对应`type`的事件

## 连接状态

`ConnectionState` 枚举定义了以下连接状态：

- **CONNECTING**: 连接中
- **OPEN**: 已连接
- **CLOSING**: 关闭中
- **CLOSED**: 已关闭
- **RECONNECTING**: 重连中

## 为什么使用 Supa Simple Socket？

相比原生WebSocket，Supa Simple Socket提供了以下优势：

1. **自动重连机制** - 网络波动时无需手动处理重连逻辑
2. **心跳保活** - 自动处理连接保活，避免连接被中断
3. **事件驱动设计** - 更直观的事件处理方式，支持链式调用
4. **类型安全** - 完整的TypeScript类型定义，提供更好的开发体验
5. **消息队列** - 连接建立前的消息自动加入队列，连接成功后发送
6. **丰富的API** - 提供更多实用方法，简化WebSocket使用
7. **状态管理** - 完整的连接状态管理和通知
8. **文件传输** - 内置文件发送功能，支持大文件和进度反馈
9. **可配置性** - 丰富的配置选项，满足不同需求
10. **调试友好** - 内置日志功能，便于调试

## 兼容性

该库可以在所有支持WebSocket API的现代浏览器和Node.js环境中使用。

## 示例

详细的示例可以查看`test/demo.html`。

## 许可证

MIT 