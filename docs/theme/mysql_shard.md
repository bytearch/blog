## 浅谈mysql数据库分库分表那些事

### 一、概述

mysql分库分表一般有如下场景

1.  垂直分表(将表分为主表和扩展表)

2. 垂直分库(将表按业务归属到不同的库,如订单相关的放到订单库,用户相关的表放到用户库等,这也是我们常说的权限回收其中的一部分)
3. 水平拆表(当数据库整体瓶颈还未到时，少量表到达性能瓶颈)
4. 水平拆库 & 拆表(数据整体性能到达瓶颈,单一写入出现性能瓶颈)

其中1，2相对较容易实现,本文重点讲讲水平拆表和水平拆库,以及基于mybatis插件方式实现水平拆分方案落地。

### 二、水平拆表

在[《聊一聊扩展字段设计》](http://bytearch.com/details/13) 一文中有讲解到基于KV水平存储扩展字段方案,这就是非常典型的可以水平分表的场景。主表和kv表是一对N关系,随着主表数据量增长,KV表最大N倍线性增长。

这里我们以分KV表水平拆分为场景

```sql
CREATE TABLE `kv` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `key` varchar(30) NOT NULL COMMENT '存储字段名',
  `value` varchar(3000) NOT NULL DEFAULT '' COMMENT '存储value',
  `create_time` timestamp NULL DEFAULT NULL COMMENT '创建时间',
  `type` tinyint(4) NOT NULL DEFAULT '1' COMMENT '字段类型: 1: string , 2: json',
  PRIMARY KEY (`id`,`name`),
  KEY `idx_create_time` (`create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='订单扩展字段KV表';
```


##### 1. 确定shardingKey

对于kv扩展字段查询,只会根据id + key 或者 id 为条件的方式查询,所以这里我们可以按照id 分片即可

##### 2. 确定拆分表数量

分512张表(实际场景具体分多少表还得根据字段增加的频次而定)

分表后表名为kv_000  ~  kv_511

id % 512 = 1 .... 分到 kv_001,

id % 512 = 2 .... 分到 kv_002

依次类推!

##### 3. 水平分表思路

###### 先看看未拆分前sql语句

1) insert 

```sql
insert into kv(id, key, value,create_time,type) value(1, "domain", "www.bytearch.com", "2020-05-17 00:00:00", 1);
```

2) select 

```sql
select id, key, value,create_time,type from kv where id = 1 and key = "domain";
```

###### 我们可以通过动态更改sql语句表名,拆分后sql语句

1) insert 

```sql
insert into kv_001 (id, key, value,create_time,type) value(1, "domain", "www.bytearch.com", "2020-05-17 00:00:00", 1);
```

2) select 

```sql
select id, key, value,create_time,type from kv_001 where id = 1 and key = "domain";
```

水平分表相对比较容易,后面会讲到基于mybatis插件实现方案

### 三、水平拆库

场景:以下我们基于博客文章表分库场景来分析

目标:

1. 分成1024张库, 000-511号库共用数据节点node1(一个数据节点保护一主多从数据源), 512~1023号库用数据节点node2

2. 支持读写分离

表结构如下(节选部分字段):

```sql
 CREATE TABLE IF NOT EXISTS `article` (
  `id` bigint(20) NOT NULL COMMENT '文章id',
  `user_id` bigint(20) NOT NULL DEFAULT '0' COMMENT '作者id',
  `status` tinyint(4) NOT NULL DEFAULT '1' COMMENT '文章状态 -1: 删除 1:草稿 2:已发布' ,
  `create_time` datetime DEFAULT NULL,
  `update_time` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_create_time` (`create_time`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COMMENT '订单信息表';
```

##### 1)确定shardingKey

按照user_id sharding

##### 2) 确定分库数量

假如分1024个库,按照user_id % 1024 hash

user_id % 1024 = 1  分到db_001库

user_id % 1024 = 2 分到db_002库

依次类推

#### 3) 架构图如下

![架构图](http://storage.bytearch.com/images/sharding_db.jpg)

##### 4) 性能线性增长

目前是2个节点,假如后期达到瓶颈,我们可以增加至4个节点

![sharding_db_4](http://storage.bytearch.com/images/sharding_db_4.jpg)



最多可以增加只1024个节点,性能线性增长

##### 5) 非shardingKey查询问题

对于水平分表/分库后,非shardingKey查询首先得考虑到

* 基因法: 见[《分布式唯一id生成器最佳实践》](http://bytearch.com/details/14) 通过主键id可以直接定位到对应库号
* 映射表法: 可以建一张mapping表关联,但是这样引入了额外的单点问题
* 冗余法: 相同数据按照另外一个字段冗余一张表
* nosql法: 将全量数据存到ES,查询ES


### 四、基于mybatis插件水平分库分表

基于mybatis分库分表,一般常用的一种是基于spring AOP方式, 另外一种基于mybatis插件。其实两种方式思路差不多。

#####  基于mybatis分库得首先解决如下问题

* 1. 如何根据shardingKey选择不同的数据源

* 2. 在哪个阶段切换数据源

* 3. 在哪个阶段 更改sql语句(也就是需要更改库名&表名, 解决了问题1和问题2,问题3就很容易解决了)

##### 问题1: 使用Spring的AbstractRoutingDataSource进行数据源的动态切换,原理是使用ThreadLocal先存储数据源key,等需要的的时候获取。

##### 问题2: 这个问题得先分析一下mybatis四大类和插件执行流程,也就是找出也就是分析Executor 和StatementHandler哪个在获取属于源之前执行

![mybatis插件四大类](http://storage.bytearch.com/images/mybatis_plugin_4.jpg)

为了比较直观解决这个问题,我分别在Executor 和StatementHandler阶段2个拦截器

```java
package com.bytearch.mybatis.sharding.plugin;

import lombok.extern.slf4j.Slf4j;
import org.apache.ibatis.executor.statement.StatementHandler;
import org.apache.ibatis.plugin.*;

import java.sql.Connection;
import java.util.Properties;

/**
 * @author bytearch
 */
@Intercepts({
        @Signature(type = StatementHandler.class,
                method = "prepare",
                args = {Connection.class, Integer.class})})
@Slf4j
public class StatementHandlerTestInterceptor implements Interceptor {
    @Override
    public Object intercept(Invocation invocation) throws Throwable {
        log.info("statementHander执行阶段>>>>>>>");
        return invocation.proceed();
    }

    @Override
    public Object plugin(Object target) {
        if (target instanceof StatementHandler) {
            return Plugin.wrap(target, this);
        }
        return target;
    }

    @Override
    public void setProperties(Properties properties) {

    }
}
```



```java
package com.bytearch.mybatis.sharding.plugin;


import lombok.extern.slf4j.Slf4j;
import org.apache.ibatis.executor.Executor;
import org.apache.ibatis.mapping.MappedStatement;
import org.apache.ibatis.plugin.*;
import org.apache.ibatis.session.ResultHandler;
import org.apache.ibatis.session.RowBounds;

import java.util.Properties;
/**
 * @author bytearch
 */
@Intercepts(
        {
                @Signature(type = Executor.class, method = "update", args = {MappedStatement.class, Object.class}),
                @Signature(type = Executor.class, method = "query", args = {MappedStatement.class, Object.class, RowBounds.class, ResultHandler.class}),

        })
@Slf4j
public class ExecutorHandlerTestInterceptor implements Interceptor {
    @Override
    public Object intercept(Invocation invocation) throws Throwable {
        log.info("Executor执行阶段 >>>>>>>>>>>");
        return invocation.proceed();
    }

    @Override
    public Object plugin(Object target) {
        if (target instanceof Executor) {
            return Plugin.wrap(target, this);
        }
        return target;
    }


    @Override
    public void setProperties(Properties properties) {

    }
}
```

实现动态数据源获取接口 

```java
package com.bytearch.mybatis.sharding.configuration;

import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.datasource.lookup.AbstractRoutingDataSource;

/**
 * @author yarw
 */
@Slf4j
public class DynamicDatasource extends AbstractRoutingDataSource {
    @Override
    protected Object determineCurrentLookupKey() {
        log.info("[获取datasourceKey:{}]", DynamicDataSourceContextHolder.getDataSourceKey());
        return DynamicDataSourceContextHolder.getDataSourceKey();
    }


```

测试结果如下

![测试结果](http://storage.bytearch.com/images/excutorProcess.jpg)



由此可知,我们需要在Executor阶段 切换数据源

##### 问题3: 可以在Executor切换完数据库完成之后, 更改sql, 或者在StatementHandler阶段更改sql

对于分库:

原始sql:

```sql
insert into article(id, uid, status,create_time,update_time) value(201333425976180992L, 1, 1, '2020-05-17 00:00:00', '2020-05-17 00:00:00')
```

目标sql:

```sql
insert into ba_test_001.article (id, user_id, status,create_time,update_time) value(201333425976180992L, 1, 1, '2020-05-17 00:00:00', '2020-05-17 00:00:00')
```




#### 完整插件如下

```java
package com.bytearch.mybatis.sharding.plugin;

import com.bytearch.mybatis.sharding.annotation.DB;
import com.bytearch.mybatis.sharding.annotation.ShardingBy;
import com.bytearch.mybatis.sharding.annotation.UseMaster;
import com.bytearch.mybatis.sharding.common.NodeNameEnum;
import com.bytearch.mybatis.sharding.configuration.DynamicDataSourceContextHolder;
import com.bytearch.mybatis.sharding.exception.ShardingException;
import com.bytearch.mybatis.sharding.strategy.IDatabaseShardingStrategy;
import com.bytearch.mybatis.sharding.strategy.IShardingStrategy;
import com.bytearch.mybatis.sharding.strategy.ITableShardingStrategy;
import com.bytearch.mybatis.sharding.strategy.ShardingStrategyUtils;
import lombok.extern.slf4j.Slf4j;
import org.apache.ibatis.executor.Executor;
import org.apache.ibatis.mapping.BoundSql;
import org.apache.ibatis.mapping.MappedStatement;
import org.apache.ibatis.mapping.SqlCommandType;
import org.apache.ibatis.mapping.SqlSource;
import org.apache.ibatis.plugin.*;
import org.apache.ibatis.session.ResultHandler;
import org.apache.ibatis.session.RowBounds;
import org.springframework.util.StringUtils;
import java.lang.annotation.Annotation;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.Map;
import java.util.Properties;

/**
 * @author bytearch
 */
@Intercepts(
        {
                @Signature(type = Executor.class, method = "update", args = {MappedStatement.class, Object.class}),
                @Signature(type = Executor.class, method = "query", args = {MappedStatement.class, Object.class, RowBounds.class, ResultHandler.class}),

        })
@Slf4j
public class ShardingInterceptor implements Interceptor {
    @Override
    public Object intercept(Invocation invocation) throws Throwable {
        Object[] args = invocation.getArgs();
        MappedStatement ms = (MappedStatement) args[0];
        if (Arrays.asList(SqlCommandType.INSERT, SqlCommandType.UPDATE, SqlCommandType.DELETE, SqlCommandType.SELECT).contains(ms.getSqlCommandType())) {
            // 读请求: 默认使用从库
            // 写请求(INSERT,UPDATE,DELETE): 使用主库
            boolean useMaster = !SqlCommandType.SELECT.equals(ms.getSqlCommandType());
            DB DB = null;
            String methodId = ms.getId();
            String className = methodId.substring(0, methodId.lastIndexOf('.'));
            String methodName = methodId.substring(methodId.lastIndexOf('.') + 1);
            //是否使用了分库分表策略
            Class clz = Class.forName(className);
            Annotation dbAnno = clz.getAnnotation(DB.class);
            if (dbAnno != null) {
                DB = (DB) dbAnno;
            }
            if (DB != null) {
                //方法是否使用了@UseMaster注解 @PartitionBy注解
                String partitionName = null;
                for (Method declaredMethod : clz.getDeclaredMethods()) {
                    if (!declaredMethod.getName().equals(methodName)) {
                        continue;
                    }
                    if (declaredMethod.getAnnotation(UseMaster.class) != null) {
                        useMaster = true;
                    }
                    ShardingBy shardingByAnno = declaredMethod.getAnnotation(ShardingBy.class);
                    if (shardingByAnno != null) {
                        partitionName = shardingByAnno.value();
                        if (DB == null) {
                            throw new ShardingException("error! must @DB on :{}", clz);
                        }
                    }
                }
                //记录sql是否需要改变
                boolean sqlNeedChanged = false;
                Object partitionKey = null;
                String schema = DB.schema();
                String tableName = DB.tableName();
                //获取partition
                Object pa = args[1];
                if (pa instanceof Map) {
                    //params中获取partitionKey
                    Map<String, Object> paMap = (Map<String, Object>) pa;
                    if (!StringUtils.isEmpty(partitionName)) {
                        partitionKey = paMap.get(partitionName);
                    }
                } else if (pa instanceof Object && partitionKey == null) {
                    //Bean对象中获取partitionKey
                    for (Field declaredField : pa.getClass().getDeclaredFields()) {
                        ShardingBy annotation = declaredField.getAnnotation(ShardingBy.class);
                        if (annotation != null) {
                            declaredField.setAccessible(true);
                            partitionKey = declaredField.get(pa);
                        }
                    }
                }
                if (partitionKey != null) {
                     log.info("获取到shardingKey:{}]", partitionKey);
                    //权重 分库 < 分表 < 分库分表(原则上同一Mapper策略只配置一种,如果配置多种依次覆盖)
                    //分库
                    IDatabaseShardingStrategy databaseShardingStrategy = ShardingStrategyUtils.getDatabaseShardingStrategy(DB);
                    if (databaseShardingStrategy != null) {
                        schema = databaseShardingStrategy.getSchemaName(DB.schema(), partitionKey);
                        databaseShardingStrategy.changeDatasourceByPartitionKey(partitionKey, useMaster);
                        sqlNeedChanged = true;
                    }
                    //分表
                    ITableShardingStrategy ITableShardingStrategy = ShardingStrategyUtils.getTableShardingStrategy(DB);
                    if (ITableShardingStrategy != null) {
                        tableName = ITableShardingStrategy.getTargetTable(DB.tableName(), partitionKey);
                        sqlNeedChanged = true;
                        NodeNameEnum nodeNameEnum = NodeNameEnum.valueOf(DB.schema());
                        if (nodeNameEnum != null) {
                            DynamicDataSourceContextHolder.useDataSourceByNodeNum(nodeNameEnum, useMaster);
                        }
                    }
                    //分库分表
                    IShardingStrategy shardingStategy = ShardingStrategyUtils.getShardingStategy(DB);
                    if (shardingStategy != null) {
                        schema = shardingStategy.getSchemaName(DB.schema(), partitionKey);
                        tableName = shardingStategy.getTargetTable(DB.tableName(), partitionKey);
                        databaseShardingStrategy.changeDatasourceByPartitionKey(partitionKey, useMaster);
                        sqlNeedChanged = true;
                    }
                } else {
                    //不分库也不分表
                    NodeNameEnum nodeNameEnum = NodeNameEnum.valueOf(DB.schema());
                    if (nodeNameEnum != null) {
                        DynamicDataSourceContextHolder.useDataSourceByNodeNum(nodeNameEnum, useMaster);
                    }
                }
                if (sqlNeedChanged) {
                    BoundSql boundSql = ms.getBoundSql(pa);
                    String originSql = boundSql.getSql();
                    log.info("[原始SQL] sql:{}", originSql);
                    String sql = originSql.replaceAll(DB.tableName(), schema + '.' + tableName);
                    log.info("[更改SQL] sql:{}", sql);
                    BoundSql boundSqlNew = new BoundSql(ms.getConfiguration(), sql, boundSql.getParameterMappings(), boundSql.getParameterObject());
                    MappedStatement mappedStatement = copyFromMappedStatement(ms, new BoundSqlSqlSource(boundSqlNew));
                    args[0] = mappedStatement;
                }
            }
        }
        return invocation.proceed();
    }

    @Override
    public Object plugin(Object target) {
        if (target instanceof Executor) {
            return Plugin.wrap(target, this);
        }
        return target;
    }

    @Override
    public void setProperties(Properties properties) {

    }

    private MappedStatement copyFromMappedStatement(MappedStatement ms, SqlSource newSqlSource) {
        MappedStatement.Builder builder = new MappedStatement.Builder(ms.getConfiguration(), ms.getId(), newSqlSource, ms.getSqlCommandType());
        builder.resource(ms.getResource());
        builder.fetchSize(ms.getFetchSize());
        builder.statementType(ms.getStatementType());
        builder.keyGenerator(ms.getKeyGenerator());
        if (ms.getKeyProperties() != null && ms.getKeyProperties().length > 0) {
            builder.keyProperty(ms.getKeyProperties()[0]);
        }
        builder.timeout(ms.getTimeout());
        builder.parameterMap(ms.getParameterMap());
        builder.resultMaps(ms.getResultMaps());
        builder.resultSetType(ms.getResultSetType());
        builder.cache(ms.getCache());
        builder.flushCacheRequired(ms.isFlushCacheRequired());
        builder.useCache(ms.isUseCache());
        return builder.build();
    }

    public static class BoundSqlSqlSource implements SqlSource {
        private BoundSql boundSql;

        public BoundSqlSqlSource(BoundSql boundSql) {
            this.boundSql = boundSql;
        }

        @Override
        public BoundSql getBoundSql(Object parameterObject) {
            return boundSql;
        }
    }

}
```

其中定义了三个注解

@useMaster 是否强制读主

```java
@Target({ElementType.METHOD})
@Retention(RetentionPolicy.RUNTIME)
@Documented
@Inherited
public @interface UseMaster {
}
```

@shardingBy 分片标识

```java
/**
 *
 * @ShardingBy作用于方法 和 Bean属性  优先级 方法 > 属性
 * @author yarw
 */
@Target({ElementType.FIELD, ElementType.METHOD})
@Retention(RetentionPolicy.RUNTIME)
@Documented
@Inherited
public @interface ShardingBy {
    /**
     * 指定分片参数
     * @return
     */
    String value() default ShardingConstant.DEFAULT_PARTITION_KEY_NAME;
}
```

@DB 定义逻辑表名 库名以及分片策略

```java
package com.bytearch.mybatis.sharding.annotation;

import com.bytearch.mybatis.sharding.strategy.IDatabaseShardingStrategy;
import com.bytearch.mybatis.sharding.strategy.IShardingStrategy;
import com.bytearch.mybatis.sharding.strategy.ITableShardingStrategy;
import com.bytearch.mybatis.sharding.strategy.impl.NotUseDatabaseShardingStrategy;
import com.bytearch.mybatis.sharding.strategy.impl.NotUseShardingStrategy;
import com.bytearch.mybatis.sharding.strategy.impl.NotUseTableShardingStrategy;

import java.lang.annotation.*;

/**
 * @author yarw
 */
@Target({ElementType.METHOD, ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
@Documented
@Inherited
public @interface DB {
    /**
     * 分表切分策略
     *
     * @return
     */
    Class<? extends ITableShardingStrategy> tableShardingStrategy() default NotUseTableShardingStrategy.class;

    /**
     * 分库切分策略
     *
     * @return
     */
    Class<? extends IDatabaseShardingStrategy> databaseShardingStrategy() default NotUseDatabaseShardingStrategy.class;

    /**
     * 分库&分表切分策略
     * @return
     */
    Class<? extends IShardingStrategy> shardingStrategy() default NotUseShardingStrategy.class;

    /**
     * 逻辑表名
     *
     * @return
     */
    String tableName();

    /**
     * 逻辑库名
     *
     * @return
     */
    String schema();

}
```



#### 测试走一波

1)编写entity

```java
package com.bytearch.mybatis.sharding.entity;

import java.util.Date;

import com.bytearch.mybatis.sharding.annotation.ShardingBy;
import lombok.Data;

@Data
public class Article {
    /**
     * 文章id
     */
    private Long id;

    /**
     * 作者id
     * 可以在此处通过注解指定shardingKey
     */
    @ShardingBy
    private Long userId;

    /**
     * 文章状态 -1: 删除 1:草稿 2:已发布
     */
    private Byte status;

    private Date createTime;

    private Date updateTime;
}
```

2) 编写mapper

```java
/**
 * @author yarw
 */
@DB(databaseShardingStrategy = LongHashDatabasePartitionStrategy.class, schema = "blog", tableName = "article")
@Mapper
public interface ArticleShardingMapper {
    /**
    * 也可以通过参数指定shardingKey参数
    */
    @Select("select * from article where id = #{id}")
    @ShardingBy("shardingKey")
    Article selectById(@Param("id") Long id, @Param("shardingKey") Long shardingKey);

    @Insert("insert into article (id, user_id, status,create_time,update_time) value(#{id}, #{userId}, #{status}, #{createTime}, #{updateTime})")
    int insert(Article kv);
}
```

3) 编写测试类

```JAVA
@Test
    public void insertArticleTest() {
        Article article = new Article();
        Long userId = 1L;
        article.setId(SeqIdUtil.nextId(userId));
        article.setUserId(userId);
        article.setStatus((byte)1);
        article.setCreateTime(new Date());
        article.setUpdateTime(new Date());
        articleShardingMapper.insert(article);
    }
    @Test
    public void selectArticleTest() {
        Article article = articleShardingMapper.selectById(201364919411081472L, SeqIdUtil.decodeId(201364919411081472L).getExtraId());
        System.out.println(article);
    }
```

4) 测试结果

Insert

![insert()](http://storage.bytearch.com/images/article_insert_test.png)

select

![query](http://storage.bytearch.com/images/article_select_test.png)

以上顺利实现mysql分库,同样的道理实现同时分库分表也很容易实现。

此插件具体实现方案已开源: https://github.com/bytearch/mybatis-sharding

目录如下:

```
.
├── bytearch_article.sql
├── mybatis-sharding.iml
├── pom.xml
├── readme.md
├── sharding.sql
├── src
│   ├── main
│   │   ├── java
│   │   │   └── com
│   │   │       └── bytearch
│   │   │           └── mybatis
│   │   │               └── sharding
│   │   │                   ├── ShardingApplication.java
│   │   │                   ├── annotation
│   │   │                   │   ├── DB.java    
│   │   │                   │   ├── ShardingBy.java  //分片标识注解
│   │   │                   │   └── UseMaster.java  //强制读主注解
│   │   │                   ├── common
│   │   │                   │   ├── NodeNameEnum.java
│   │   │                   │   └── ShardingConstant.java
│   │   │                   ├── configuration
│   │   │                   │   ├── DynamicDataSourceContextHolder.java
│   │   │                   │   ├── DynamicDatasource.java
│   │   │                   │   ├── NormalDateSourceConfig.java
│   │   │                   │   ├── ShardingConfiguration.java
│   │   │                   │   └── ShardingDateSourceConfig.java
│   │   │                   ├── dao
│   │   │                   │   ├── KVShardingMapper.java
│   │   │                   │   └── KvShardingMapper.xml
│   │   │                   ├── dto
│   │   │                   │   ├── DataSourceKeyNodeDTO.java
│   │   │                   │   └── DataSourceNodeDTO.java
│   │   │                   ├── entity
│   │   │                   │   └── Kv.java
│   │   │                   ├── exception
│   │   │                   │   └── ShardingException.java
│   │   │                   ├── plugin  //插件
│   │   │                   │   ├── ShardingInterceptor.java
│   │   │                   ├── sequence  //唯一id生成器
│   │   │                   │   ├── IdEntity.java
│   │   │                   │   ├── IpUtil.java
│   │   │                   │   └── SeqIdUtil.java
│   │   │                   └── strategy //策略类 
│   │   │                       ├── IDatabaseShardingStrategy.java
│   │   │                       ├── IShardingStrategy.java
│   │   │                       ├── ITableShardingStrategy.java
│   │   │                       ├── ShardingStrategyUtils.java
│   │   │                       └── impl
│   │   │                           ├── LongHashDatabasePartitionStrategy.java
│   │   │                           ├── LongHashTableShardingStrategy.java
│   │   │                           ├── NotUseDatabaseShardingStrategy.java
│   │   │                           ├── NotUseShardingStrategy.java
│   │   │                           └── NotUseTableShardingStrategy.java
│   │   └── resources
│   │       ├── application.yml
│   │       └── mybatis
│   │           └── mybatis-config.xml
│   └── test
│       └── java
│           └── com
│               └── bytearch
│                   └── mybatis
│                       └── sharding
│                           └── DBApplicationTests.java

```

### 五、总结
mysql分库分表,首先得找到瓶颈在哪里(IO or CPU),是分库还是分表,分多少？不能为了分库分表而拆分。
原则上是尽量先垂直拆分 后 水平拆分。
以上基于mybatis插件分库分表是一种实现思路,还有很多不完善的地方,
例如: 
* 目前sql是直接替换的,这里有很大隐患, 
* 分库后,跨库事务的如何处理等等
以上仅供参考!有其它思路可以欢迎联系我一起交流.