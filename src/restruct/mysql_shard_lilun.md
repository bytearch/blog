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
  PRIMARY KEY (`id`),
  UNIQUE KEY `order_id` (`order_id`,`key`),
  KEY `idx_create_time` (`create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='订单扩展字段KV表';
```



##### 1. 确定shardingKey

对于扩展字段查询,只会根据id + key 或者 id 为条件的方式查询,所以这里我们可以按照id sharding即可

##### 2. 确定拆分表数量

分512张表(实际场景具体分多少表还得根据字段增加的频次而定)

分表后表名为order_kv_000  ~  order_kv_511

id % 512 = 1 .... 分到 order_kv_001,

id % 512 = 2 .... 分到 order_kv_002

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

分1024个库,按照user_id % 1024 hash

user_id % 1024 = 1  分到db_001

user_id % 1024 = 2 分到db_002

依次类推

#### 3) 架构图如下

![架构图](http://storage.bytearch.com/images/sharding_db.jpg)

      ##### 4)后期线性扩容问题

目前是2个节点,假如后期达到瓶颈,我们可以增加至4个节点

![sharding_db_4](../images/sharding_db_4.jpg)



