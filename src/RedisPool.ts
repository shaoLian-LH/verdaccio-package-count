// 一份简单的缓存池
import Redis from 'ioredis';
export interface RedisConfig { 
  port: number
  host: string
  password: string
  db: number
}

export default class RedisPool {
  private _pool: Redis[] = [];
  private _redisConfig: RedisConfig

  private async _prepareRedisClient(number = 5) {
    const { port, host, password, db = 0 } = this._redisConfig
    const redisClient = new Redis(this._redisConfig);
    for (let i = 0; i < number; i++) {
      const redisClient = new Redis(Number(port), host, {
        password,
        retryStrategy(times) {
          const delay = Math.min(times * 50, 2000)
          return delay
        },
      })
      await redisClient.select(db)
      this._pool.push(redisClient)
    }
  }
  public constructor(config: RedisConfig) {
    this._redisConfig = config
    // 初始化 10 个 redis 连接
    this._prepareRedisClient(10)
  }

  public async getRedisClient() {
    if (this._pool.length) {
      return this._pool.pop() as Redis;
    } else {
      await this._prepareRedisClient(5)
    }

    const redisClient = new Redis(this._redisConfig);
    await redisClient.select(Number(this._redisConfig.db));
    return redisClient;
  }

  public async releaseRedisClient(redisClient: Redis) {
    this._pool.push(redisClient);
  }
}
