import { Logger, IPluginMiddleware, IBasicAuth, IStorageManager, PluginOptions } from '@verdaccio/types';
import {Router, Request, Response, NextFunction, Application} from 'express';
import { CustomConfig } from '../types/index';
import type { RedisConfig } from './RedisPool'
import RedisPool from './RedisPool';

const parseJSON = (mayBeJSON: unknown, initial = {}) => { 
  try {
    return JSON.parse(mayBeJSON as string) || initial
  } catch (e) { 
    return initial
  }
}

export default class VerdaccioMiddlewarePlugin implements IPluginMiddleware<CustomConfig> {
  public logger: Logger;
  public foo: string;
  public redisConfig: RedisConfig
  private redisPool: RedisPool

  public constructor(config: CustomConfig, options: PluginOptions<CustomConfig>) {
    this.foo = config.foo !== undefined ? config.strict_ssl : true;
    this.logger = options.logger;
    this.redisConfig = config.redis as RedisConfig
    this.redisPool = new RedisPool(this.redisConfig)
  }

  private async _getRedisClient() { 
    const redisClient = await this.redisPool.getRedisClient()
    return redisClient
  }

  public register_middlewares(
      app: Application,
      auth: IBasicAuth<CustomConfig>,
      _storage: IStorageManager<CustomConfig>,
  ): void {
    const downloadInterceptor = Router()
    // 拦截和获取包相关的请求
    downloadInterceptor.get('/*/-/*', async (req: Request, res: Response, next: NextFunction) => {
      // 将 GET 操作视为下载包的操作
      if (req.method !== 'GET') return 
      
      try {     
        // 获取具体报名，带 @ 的部分包无法从第二个 param 获取，但是第一个一定是全名
        const packageName = req.params[0]
        
        // 获取 redis 客户端
        const redisClient = await this._getRedisClient()

        // 获取下载次数的缓存
        const today = new Date(Date.now() + 8 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10)
        const cacheKey = `download-${today}`
        const todayDownloadCache = await redisClient.hget(cacheKey, packageName)
        const downloadTempJsonContent = parseJSON(todayDownloadCache)
        
        // 获取压缩包，例如：@verdaccio/monorepo-1.0.0.tgz
        const tgzFile = req.params[1]
        // 获取包名和版本号，例如：@verdaccio/monorepo-1.0.0
        const packageAndVersion = tgzFile.split('.').slice(0, -1).join('.')
        const nameAndVersionArr = packageAndVersion
          .split('-')
        
        // 找到第一个字符不仅仅是字符的位置，兼容版本中带有 - 的情况
        const firstIndexNotJustAZChars = nameAndVersionArr.findIndex(
          (char) => !/[a-zA-Z]/.test(char)
        ) || 0
        const packageVersion = nameAndVersionArr.slice(
          firstIndexNotJustAZChars,
          nameAndVersionArr.length
        ).join('-')

        // 记录下载次数
        const packageRecord = downloadTempJsonContent[packageVersion]
        if (packageRecord) {
          downloadTempJsonContent[packageVersion] = packageRecord + 1
        } else {
          downloadTempJsonContent[packageVersion] = 1
        }

        // 将下载次数写入缓存
        Object.assign(downloadTempJsonContent, packageRecord)
        await redisClient.hset(
          cacheKey,
          packageName,
          JSON.stringify(downloadTempJsonContent)
        )
      } catch (e) {
        console.error('package download 计算时失败，原因是 - ', e)
      } finally { 
        next()
      }
    })
    
    app.use(downloadInterceptor)
  }
}
