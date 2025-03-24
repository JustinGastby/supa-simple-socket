/**
 * SupaSimpleSocket - 一个简单易用的WebSocket客户端工具
 * 支持心跳机制、断点重连、事件订阅等功能
 */

// 回调函数类型定义
type EventCallback<T = any> = (data: T) => void;

// 预定义常用事件类型
type BuiltInEvents = 'open' | 'message' | 'close' | 'error' | 'reconnect' | 'statusChange' | 'connectionTimeout' | 'heartbeatTimeout' | 'reconnectFailed' | 'reconnecting' | string;

// 增强的 SocketMessage 接口，支持泛型
interface SocketMessage<T = any> {
  type: string;
  payload: T; // 使用泛型指定消息的具体数据类型
}

// 状态变化回调
type StatusChangeCallback = (newState: ConnectionState, oldState: ConnectionState) => void;

// 配置选项接口
interface SupaSocketOptions {
  url: string;
  reconnectLimit?: number;  // 最大重连次数
  reconnectInterval?: number;  // 重连间隔（毫秒）
  heartbeatInterval?: number;  // 心跳间隔（毫秒）
  heartbeatTimeout?: number;   // 心跳超时时间（毫秒）
  autoReconnect?: boolean;     // 是否自动重连
  debug?: boolean;             // 是否开启调试日志
  protocols?: string | string[]; // WebSocket协议
  binaryType?: BinaryType;     // 二进制数据类型
  onOpen?: (event: Event) => void; // 连接打开时的回调
  onClose?: (event: CloseEvent) => void; // 连接关闭时的回调
  onError?: (event: Event) => void; // 连接错误时的回调
  onStatusChange?: StatusChangeCallback; // 状态变化的回调
  pingMessage?: any;          // 自定义心跳消息
  pongMessage?: any;          // 自定义心跳响应消息
  autoParseMessage?: boolean; // 是否自动解析JSON消息
  maxReconnectDelay?: number; // 最大重连延迟(指数退避策略)
  retryOnError?: boolean;     // 错误时是否重试
  connectionTimeout?: number; // 连接超时时间(毫秒)
}

// 连接状态枚举
enum ConnectionState {
  CONNECTING = 0,
  OPEN = 1,
  CLOSING = 2,
  CLOSED = 3,
  RECONNECTING = 4,
}

// 为 EventBus 类添加泛型支持
class EventBus<T = any> {
  private events: Map<BuiltInEvents, EventCallback<T>[]> = new Map();
  
  // 添加事件监听器
  public on(event: BuiltInEvents, callback: EventCallback<T>): void {
    if (!this.events.has(event)) {
      this.events.set(event, []);
    }
    this.events.get(event)!.push(callback);
  }
  
  // 移除事件监听器
  public off(event: BuiltInEvents, callback?: EventCallback<T>): void {
    if (!this.events.has(event)) {
      return;
    }
    
    if (!callback) {
      this.events.delete(event);
    } else {
      const callbacks = this.events.get(event)!;
      this.events.set(event, callbacks.filter(cb => cb !== callback));
      if (this.events.get(event)!.length === 0) {
        this.events.delete(event);
      }
    }
  }
  
  // 触发事件
  public emit(event: BuiltInEvents, data: T): void {
    if (!this.events.has(event)) {
      return;
    }
    
    const callbacks = this.events.get(event)!;
    callbacks.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error(`[EventBus] Error in event handler for ${event}:`, error);
      }
    });
  }
  
  // 检查是否有事件监听器
  public hasListeners(event: BuiltInEvents): boolean {
    return this.events.has(event) && this.events.get(event)!.length > 0;
  }
  
  // 获取所有注册的事件
  public getEvents(): BuiltInEvents[] {
    return Array.from(this.events.keys());
  }
  
  // 清除所有事件监听器
  public clear(): void {
    this.events.clear();
  }
}

// 连接状态管理类
class ConnectionManager {
  private _state: ConnectionState = ConnectionState.CLOSED;
  private statusChangeCallbacks: StatusChangeCallback[] = [];
  
  public get state(): ConnectionState {
    return this._state;
  }
  
  public set state(newState: ConnectionState) {
    if (this._state === newState) {
      return;
    }
    
    const oldState = this._state;
    this._state = newState;
    
    // 触发状态变化回调
    this.statusChangeCallbacks.forEach(callback => {
      try {
        callback(newState, oldState);
      } catch (error) {
        console.error('[ConnectionManager] Error in status change callback:', error);
      }
    });
  }
  
  public onStatusChange(callback: StatusChangeCallback): void {
    this.statusChangeCallbacks.push(callback);
  }
  
  public removeStatusChangeCallback(callback: StatusChangeCallback): void {
    this.statusChangeCallbacks = this.statusChangeCallbacks.filter(cb => cb !== callback);
  }
}

/**
 * SupaSocket主类
 */
export default class SupaSocket {
  private ws: WebSocket | null = null;
  private reconnectCount = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private heartbeatTimeoutTimer: NodeJS.Timeout | null = null;
  private connectionTimeoutTimer: NodeJS.Timeout | null = null;
  private connectionManager = new ConnectionManager();
  private eventBus = new EventBus();
  private messageQueue: any[] = []; // 消息队列，用于存储连接建立前的消息
  private lastMessageTime = 0; // 最后一次收到消息的时间
  private explicitClose = false; // 是否是手动关闭的连接
  private currentBackoff = 0; // 当前重连延迟(指数退避)

  /**
   * 构造函数
   * @param options 配置选项
   */
  constructor(private options: SupaSocketOptions) {
    // 设置默认选项
    this.options = {
      reconnectLimit: 5,
      reconnectInterval: 5000,
      heartbeatInterval: 30000,
      heartbeatTimeout: 5000,
      autoReconnect: true,
      debug: false,
      autoParseMessage: true,
      maxReconnectDelay: 30000, // 最大30秒重连延迟
      retryOnError: true,
      connectionTimeout: 10000, // 10秒连接超时
      pingMessage: { type: 'ping', time: 0 },
      pongMessage: { type: 'pong' },
      ...options
    };
    
    // 注册连接状态变化回调
    this.connectionManager.onStatusChange((newState, oldState) => {
      this.log(`状态变化: ${ConnectionState[oldState]} -> ${ConnectionState[newState]}`);
      
      // 调用用户自定义的状态变化回调
      if (this.options.onStatusChange) {
        this.options.onStatusChange(newState, oldState);
      }
      
      // 触发状态变化事件
      this.eventBus.emit('statusChange', { 
        newState, 
        oldState,
        newStateName: ConnectionState[newState],
        oldStateName: ConnectionState[oldState]
      });
    });

    // 初始化连接
    this.connect();
    
    // 暴露ConnectionState枚举
    Object.defineProperty(this, 'ConnectionState', {
      value: ConnectionState,
      writable: false,
      enumerable: false,
      configurable: false
    });
  }

  /**
   * 获取当前连接状态
   */
  public get connectionState(): ConnectionState {
    return this.connectionManager.state;
  }
  
  /**
   * 获取连接状态名称
   */
  public get connectionStateName(): string {
    return ConnectionState[this.connectionManager.state];
  }
  
  /**
   * 获取已注册的事件列表
   */
  public get events(): string[] {
    return this.eventBus.getEvents();
  }
  
  /**
   * 获取最后一次收到消息的时间
   */
  public get lastReceivedTime(): Date {
    return new Date(this.lastMessageTime);
  }
  
  /**
   * 获取最后一次收到消息距现在的时间(ms)
   */
  public get timeSinceLastMessage(): number {
    if (this.lastMessageTime === 0) return 0;
    return Date.now() - this.lastMessageTime;
  }
  
  /**
   * 获取连接状态是否为已打开
   */
  public get isConnected(): boolean {
    return this.connectionManager.state === ConnectionState.OPEN;
  }
  
  /**
   * 获取当前重连次数
   */
  public get currentReconnectAttempt(): number {
    return this.reconnectCount;
  }

  /**
   * 连接WebSocket
   * @private
   */
  private connect(): void {
    // 清除之前的连接超时计时器
    if (this.connectionTimeoutTimer) {
      clearTimeout(this.connectionTimeoutTimer);
      this.connectionTimeoutTimer = null;
    }
    
    this.connectionManager.state = ConnectionState.CONNECTING;
    this.log('正在连接...');
    this.explicitClose = false;

    try {
      this.ws = new WebSocket(this.options.url, this.options.protocols);
      
      // 设置二进制数据类型
      if (this.options.binaryType) {
        this.ws.binaryType = this.options.binaryType;
      }
      
      // 设置连接超时
      if (this.options.connectionTimeout && this.options.connectionTimeout > 0) {
        this.connectionTimeoutTimer = setTimeout(() => {
          this.log('连接超时');
          this.eventBus.emit('connectionTimeout', { 
            url: this.options.url, 
            timeout: this.options.connectionTimeout 
          });
          
          if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
            this.ws.close();
            this.handleConnectionFailure();
          }
        }, this.options.connectionTimeout);
      }

      this.ws.onopen = (event) => {
        // 清除连接超时计时器
        if (this.connectionTimeoutTimer) {
          clearTimeout(this.connectionTimeoutTimer);
          this.connectionTimeoutTimer = null;
        }
        
        this.connectionManager.state = ConnectionState.OPEN;
        this.log('连接成功');
      this.reconnectCount = 0; // 重置重连计数器
        this.currentBackoff = 0; // 重置退避计数
        
        // 处理连接成功后的消息队列
        this.processMessageQueue();
        
        // 启动心跳检测
      this.startHeartbeat();
        
        // 调用用户定义的onOpen回调
        if (this.options.onOpen) {
          this.options.onOpen(event);
        }
        
        // 触发自定义open事件
        this.eventBus.emit('open', event);
    };

    this.ws.onmessage = (event) => {
        this.lastMessageTime = Date.now(); // 更新最后收到消息的时间
        
        try {
          let data = event.data;
          
          // 自动解析JSON消息
          if (this.options.autoParseMessage && typeof data === 'string') {
            try {
              data = JSON.parse(data);
            } catch (e) {
              // 如果不是有效的JSON，保持原样
              this.log('消息不是有效的JSON格式，保持原始格式');
            }
          }
          
          // 检查是否是心跳响应
          if (this.isPongMessage(data)) {
            this.log('收到心跳响应');
            this.resetHeartbeatTimeout();
            return;
          }
          
          // 触发message事件
          this.eventBus.emit('message', data);
          
          // 对于JSON对象，如果有type字段，也触发对应type的事件
          if (data && typeof data === 'object' && data.type) {
            this.eventBus.emit(data.type, data);
          }
        } catch (error) {
          this.log('消息处理错误', error);
          this.eventBus.emit('error', { type: 'messageError', error, raw: event.data });
        }
      };

      this.ws.onclose = (event) => {
        // 清除连接超时计时器
        if (this.connectionTimeoutTimer) {
          clearTimeout(this.connectionTimeoutTimer);
          this.connectionTimeoutTimer = null;
        }
        
        this.connectionManager.state = ConnectionState.CLOSED;
        this.log(`连接关闭: ${event.code} ${event.reason}`);
        
        // 清理心跳定时器
        this.clearHeartbeatTimers();
        
        // 调用用户定义的onClose回调
        if (this.options.onClose) {
          this.options.onClose(event);
        }
        
        // 触发自定义close事件
        this.eventBus.emit('close', event);
        
        // 如果不是手动关闭且需要自动重连
        if (!this.explicitClose && this.options.autoReconnect) {
          this.performReconnect();
        }
    };

    this.ws.onerror = (error) => {
        this.log('连接错误', error);
        
        // 调用用户定义的onError回调
        if (this.options.onError) {
          this.options.onError(error);
        }
        
        // 触发自定义error事件
        this.eventBus.emit('error', error);
        
        // 如果在连接中出错，可能需要处理连接失败
        if (this.ws && this.ws.readyState === WebSocket.CONNECTING && this.options.retryOnError) {
          this.handleConnectionFailure();
        }
      };
    } catch (error) {
      this.log('连接初始化失败', error);
      this.connectionManager.state = ConnectionState.CLOSED;
      this.eventBus.emit('error', { type: 'initError', error });
      
      // 如果需要自动重连
      if (this.options.autoReconnect) {
        this.performReconnect();
      }
    }
  }
  
  /**
   * 处理连接失败
   * @private
   */
  private handleConnectionFailure(): void {
    // 清除当前WebSocket对象
    this.ws = null;
    
    // 如果需要自动重连
    if (this.options.autoReconnect) {
      this.performReconnect();
    } else {
      this.connectionManager.state = ConnectionState.CLOSED;
    }
  }
  
  /**
   * 判断消息是否为心跳响应
   * @param data 接收到的消息数据
   * @private
   */
  private isPongMessage(data: any): boolean {
    if (!data) return false;
    
    // 如果是字符串，尝试解析为JSON
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch (e) {
        return false; // 不是有效的JSON
      }
    }
    
    // 如果配置了自定义的pong消息检查
    const pongMessage = this.options.pongMessage;
    if (pongMessage && typeof pongMessage === 'object') {
      // 检查所有的pongMessage键值是否匹配
      return Object.keys(pongMessage).every(key => 
        data[key] !== undefined && data[key] === pongMessage[key]
      );
    }
    
    // 默认检查type: 'pong'
    return data && typeof data === 'object' && data.type === 'pong';
  }

  /**
   * 处理消息队列
   * @private
   */
  private processMessageQueue(): void {
    if (this.messageQueue.length > 0) {
      this.log(`处理队列中的 ${this.messageQueue.length} 条消息`);
      
      // 发送所有排队的消息
      this.messageQueue.forEach(msg => this.send(msg));
      
      // 清空队列
      this.messageQueue = [];
    }
  }

  /**
   * 启动心跳检测
   * @private
   */
  private startHeartbeat(): void {
    this.clearHeartbeatTimers();
    
    if (!this.options.heartbeatInterval || this.options.heartbeatInterval <= 0) {
      return;
    }
    
    this.log('启动心跳检测');
    this.heartbeatTimer = setInterval(() => {
      // 创建心跳消息，如果是对象类型，添加时间戳
      let pingMessage = this.options.pingMessage;
      if (typeof pingMessage === 'object' && pingMessage !== null) {
        pingMessage = { ...pingMessage, time: Date.now() };
      }
      
      this.log('发送心跳包');
      this.send(pingMessage);
      
      // 设置心跳超时检测
      this.startHeartbeatTimeout();
    }, this.options.heartbeatInterval);
  }

  /**
   * 启动心跳超时检测
   * @private
   */
  private startHeartbeatTimeout(): void {
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer);
    }
    
    if (!this.options.heartbeatTimeout || this.options.heartbeatTimeout <= 0) {
      return;
    }

    this.heartbeatTimeoutTimer = setTimeout(() => {
      this.log('心跳超时，重新连接');
      this.eventBus.emit('heartbeatTimeout', { time: Date.now() });
      
      // 关闭当前连接并重连
      if (this.ws) {
        try {
          this.ws.close();
        } catch (e) {
          this.log('关闭连接时出错', e);
        }
      }
      
      if (this.options.autoReconnect) {
        this.performReconnect();
      }
    }, this.options.heartbeatTimeout);
  }

  /**
   * 重置心跳超时
   * @private
   */
  private resetHeartbeatTimeout(): void {
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = null;
    }
  }

  /**
   * 清理心跳定时器
   * @private
   */
  private clearHeartbeatTimers(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = null;
    }
  }

  /**
   * 断点重连
   * @private
   */
  private performReconnect(): void {
    const { reconnectLimit, reconnectInterval, maxReconnectDelay } = this.options;
    
    if (this.reconnectCount >= (reconnectLimit || 5)) {
      this.log('重连失败: 超过最大重连次数');
      this.eventBus.emit('reconnectFailed', { 
        attempts: this.reconnectCount, 
        limit: reconnectLimit 
      });
      return;
    }

    this.connectionManager.state = ConnectionState.RECONNECTING;
    this.reconnectCount++;
    
    // 计算指数退避延迟
    let delay = reconnectInterval || 5000;
    if (this.currentBackoff > 0) {
      // 使用指数退避策略
      delay = Math.min(
        maxReconnectDelay || 30000,
        delay * Math.pow(1.5, this.currentBackoff)
      );
    }
    this.currentBackoff++;
    
    this.log(`正在重连 (${this.reconnectCount}/${reconnectLimit})，延迟 ${delay}ms`);
    this.eventBus.emit('reconnecting', { 
      attempt: this.reconnectCount, 
      limit: reconnectLimit,
      delay
    });

    setTimeout(() => {
      this.connect();
    }, delay);
  }

  /**
   * 发送消息
   * @param data 要发送的数据
   * @returns 是否发送成功
   */
  public send(data: any): boolean {
    // 如果连接已打开，直接发送
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        const message = this.prepareMessage(data);
        this.ws.send(message);
        return true;
      } catch (error) {
        this.log('发送消息失败', error);
        this.eventBus.emit('error', { type: 'sendError', error, data });
        return false;
      }
    } 
    // 如果连接正在建立中或重连中，加入队列
    else if (
      this.connectionManager.state === ConnectionState.CONNECTING || 
      this.connectionManager.state === ConnectionState.RECONNECTING
    ) {
      this.log('连接未就绪，消息加入队列');
      this.messageQueue.push(data);
      return true;
    } 
    // 连接已关闭
    else {
      this.log('连接已关闭，无法发送消息');
      this.eventBus.emit('error', { 
        type: 'sendError', 
        error: new Error('连接已关闭'), 
        data 
      });
      return false;
    }
  }
  
  /**
   * 准备要发送的消息
   * @param data 原始消息数据
   * @returns 准备好的消息
   * @private
   */
  private prepareMessage(data: any): string | ArrayBuffer | Blob {
    // 如果已经是字符串、ArrayBuffer或Blob，直接返回
    if (
      typeof data === 'string' || 
      data instanceof ArrayBuffer || 
      data instanceof Blob
    ) {
      return data;
    }
    
    // 其他类型转为JSON字符串
    return JSON.stringify(data);
  }
  
  /**
   * 发送二进制数据
   * @param data 二进制数据
   * @returns 是否发送成功
   */
  public sendBinary(data: ArrayBuffer | Blob): boolean {
    return this.send(data);
  }
  
  /**
   * 发送文本消息
   * @param text 文本消息
   * @returns 是否发送成功
   */
  public sendText(text: string): boolean {
    return this.send(text);
  }
  
  /**
   * 发送JSON对象
   * @param data JSON对象
   * @returns 是否发送成功
   */
  public sendJson(data: Record<string, any>): boolean {
    return this.send(data);
  }
  
  /**
   * 发送文件
   * @param file 文件对象
   * @param options 发送选项
   * @returns Promise，解析为发送是否成功
   */
  public async sendFile(
    file: File, 
    options?: { 
      onProgress?: (progress: number) => void,
      chunkSize?: number
    }
  ): Promise<boolean> {
    // 如果WebSocket未连接，直接返回失败
    if (!this.isConnected) {
      this.eventBus.emit('error', { 
        type: 'sendError', 
        error: new Error('连接已关闭，无法发送文件'), 
        file 
      });
      return false;
    }
    
    try {
      // 发送文件元数据
      this.send({
        type: 'file_start',
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        timestamp: Date.now()
      });
      
      // 读取文件并分块发送
      const chunkSize = options?.chunkSize || 64 * 1024; // 默认64KB
      const totalChunks = Math.ceil(file.size / chunkSize);
      let sentChunks = 0;
      
      for (let start = 0; start < file.size; start += chunkSize) {
        const end = Math.min(start + chunkSize, file.size);
        const chunk = file.slice(start, end);
        
        // 读取块数据
        const buffer = await chunk.arrayBuffer();
        
        // 发送块数据
        const success = this.sendBinary(buffer);
        if (!success) throw new Error('发送文件块失败');
        
        // 更新进度
        sentChunks++;
        const progress = (sentChunks / totalChunks) * 100;
        options?.onProgress?.(progress);
        
        // 如果连接已断开，中止发送
        if (!this.isConnected) {
          throw new Error('发送过程中连接断开');
        }
      }
      
      // 发送文件结束标记
      this.send({
        type: 'file_end',
        fileName: file.name,
        timestamp: Date.now()
      });
      
      return true;
    } catch (error) {
      this.log('发送文件失败', error);
      this.eventBus.emit('error', { 
        type: 'fileSendError', 
        error, 
        file 
      });
      return false;
    }
  }

  /**
   * 事件监听
   * @param event 事件名称
   * @param callback 回调函数
   * @returns this实例，支持链式调用
   */
  public on<T = any>(event: BuiltInEvents, callback: EventCallback<T>): this {
    this.eventBus.on(event, callback);
    return this;
  }

  /**
   * 移除事件监听
   * @param event 事件名称
   * @param callback 可选的回调函数，如不提供则移除该事件的所有监听器
   * @returns this实例，支持链式调用
   */
  public off(event: BuiltInEvents, callback?: EventCallback): this {
    this.eventBus.off(event, callback);
    return this;
  }
  
  /**
   * 一次性事件监听，触发后自动移除
   * @param event 事件名称
   * @param callback 回调函数
   * @returns this实例，支持链式调用
   */
  public once<T = any>(event: BuiltInEvents, callback: EventCallback<T>): this {
    const onceCallback = ((data: T) => {
      callback(data);
      this.off(event, onceCallback as EventCallback);
    }) as EventCallback;
    
    this.on(event, onceCallback);
    return this;
  }
  
  /**
   * 清除所有事件监听器
   * @returns this实例，支持链式调用
   */
  public clearAllListeners(): this {
    this.eventBus = new EventBus();
    return this;
  }
  
  /**
   * 检查是否有特定事件的监听器
   * @param event 事件名称
   * @returns 是否有监听器
   */
  public hasListeners(event: BuiltInEvents): boolean {
    return this.eventBus.hasListeners(event);
  }

  /**
   * 关闭连接
   * @param code 关闭代码
   * @param reason 关闭原因
   */
  public close(code?: number, reason?: string): void {
    this.explicitClose = true; // 标记为手动关闭
    
    if (this.ws) {
      this.connectionManager.state = ConnectionState.CLOSING;
      this.clearHeartbeatTimers();
      
      try {
        this.ws.close(code, reason);
      } catch (error) {
        this.log('关闭连接失败', error);
      }
    }
    
    this.connectionManager.state = ConnectionState.CLOSED;
  }
  
  /**
   * 重新连接 - 手动触发重连
   * @param resetReconnectCount 是否重置重连计数器
   * @returns 是否开始重连
   */
  public reconnect(resetReconnectCount: boolean = false): boolean {
    // 如果当前正在连接或者已连接，先关闭
    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {
        this.log('关闭现有连接时出错', e);
      }
    }
    
    // 重置重连计数器（如果需要）
    if (resetReconnectCount) {
      this.reconnectCount = 0;
      this.currentBackoff = 0;
    }
    
    // 重置手动关闭标记，允许自动重连
    this.explicitClose = false;
    
    // 开始连接
    this.connect();
    return true;
  }
  
  /**
   * 检查连接状态并在需要时重连
   * @returns 当前连接状态
   */
  public checkConnection(): ConnectionState {
    const state = this.connectionManager.state;
    
    // 如果连接已关闭或出错，且不是手动关闭的，尝试重连
    if (
      (state === ConnectionState.CLOSED) && 
      !this.explicitClose && 
      this.options.autoReconnect
    ) {
      this.performReconnect();
    }
    
    return state;
  }
  
  /**
   * 更新配置选项
   * @param options 新的配置选项，会与现有选项合并
   * @returns this实例，支持链式调用
   */
  public updateOptions(options: Partial<SupaSocketOptions>): this {
    // 保存旧的URL，用于检测是否需要重连
    const oldUrl = this.options.url;
    
    // 合并选项
    this.options = {
      ...this.options,
      ...options
    };
    
    // 如果URL改变且当前已连接，需要重新连接
    if (oldUrl !== this.options.url && this.isConnected) {
      this.log('URL已更改，重新连接');
      this.reconnect(true);
    }
    
    // 如果心跳间隔改变且当前已连接，重新启动心跳
    if (this.isConnected && this.heartbeatTimer) {
      this.startHeartbeat();
    }
    
    return this;
  }
  
  /**
   * 获取当前配置选项
   * @returns 当前配置选项的副本
   */
  public getOptions(): SupaSocketOptions {
    return { ...this.options };
  }
  
  /**
   * 暂时禁用自动重连
   * @returns this实例，支持链式调用
   */
  public disableAutoReconnect(): this {
    this.options.autoReconnect = false;
    return this;
  }
  
  /**
   * 启用自动重连
   * @returns this实例，支持链式调用
   */
  public enableAutoReconnect(): this {
    this.options.autoReconnect = true;
    return this;
  }

  /**
   * 输出日志信息
   * @param message 日志消息
   * @param data 附加数据
   * @private
   */
  private log(message: string, data?: any): void {
    if (this.options.debug) {
      if (data) {
        console.log(`[SupaSocket] ${message}`, data);
      } else {
        console.log(`[SupaSocket] ${message}`);
      }
    }
  }
  
  /**
   * 销毁实例，清理所有资源
   */
  public destroy(): void {
    // 关闭WebSocket连接
    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {
        // 忽略关闭错误
      }
      this.ws = null;
    }
    
    // 清理定时器
    this.clearHeartbeatTimers();
    
    if (this.connectionTimeoutTimer) {
      clearTimeout(this.connectionTimeoutTimer);
      this.connectionTimeoutTimer = null;
    }
    
    // 清理事件监听器
    this.clearAllListeners();
    
    // 更新状态
    this.connectionManager.state = ConnectionState.CLOSED;
    
    // 清空消息队列
    this.messageQueue = [];
  }
}

// 导出类型和枚举
export { 
  SupaSocketOptions, 
  ConnectionState, 
  EventCallback,
  StatusChangeCallback 
};