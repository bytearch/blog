---
title: 浅谈分布式唯一Id生成器之最佳实践
date: 2020-05-12
tags: 
  - 系统重构系列
  - Java
  - 架构好文
author: bytearch
location: Beijing
summary: 当数据库分表或者分库后，如何能够快速拿到一个唯一序列号，是经常遇到的问题。今天我们就来讨论一下如何设计分布式全局唯一永不重复Id生成器。  
---

## 1、概述
当数据库分表或者分库后，如何能够快速拿到一个唯一序列号，是经常遇到的问题。今天我们就来讨论一下如何设计分布式全局唯一永不重复Id生成器。

## 2、业界都有哪些做法
* UUID(机器的网卡 + 当地时间 + 一个随记数 => UUID)。
优点：本地生成，生成简单，性能好，没有高可用风险
缺点：长度过长，存储冗余，且无序不可读，查询效率低
不建议使用

* 采用一个集中式ID生成器，它可以是Redis，也可以是ZooKeeper，也可以利用数据库的表记录最后分配的ID。
缺点: 有网络调用,并且有单点问题

* 类似Twitter的Snowflake算法，它给每台机器分配一个唯一标识，然后通过时间戳+标识+自增实现全局唯一ID。
优点:ID生成算法完全是一个无状态机，无网络调用，高效可靠。
缺点:是如果唯一标识有重复，会造成ID冲突。
![雪花算法](http://storage.bytearch.com/images/snowflake-64bit.jpg)
(以上图片来源于网络)

## 3、唯一Id最佳实践
这里所谓的最佳,是根据以往经验所得,具体得结合实际场景
首先来看看我们唯一id生成器需要满足的场景
* 唯一性
* 希望是完全定制的,也就是说通过id能反解除我们要的信息
* 粗略有序
* 高性能

##### 1)这里以分库为例:
我们的做法是分库, 分库又分表维护起来比较麻烦,而且很多情况下只分库就能够解决问题。
那么,分多少个库怎么计算呢？
* 1) 按容量计算 一般表容量不超过10G性能比较好
* 2) 行数,一般来说单表2000万以下性能比较好
所以分多少库这个要看业务增长的量来算(以下我们按第二种方式来计算)
假如现在每天100万订单,目标是在现在基础上10倍的量来设计,那么就是一天1000万单
一个月就是3亿数据
##### 2) 假如业务要求1年前数据归档,那么分库数计算为:
(3亿 * 12)/2000万 =  180 
所以我们计算分库为256(需要为2^n,这样方便以后扩展)

*小插曲:我们曾经一步到位,直接分1024个库*

##### 3) 唯一id生成器规则

|首位(保留)|毫秒级时间差|机器号(workerId)|用户标识(extraId)| 自增序列(sequenceId) |
|------|--------------|------- |---- |-------   |
|1bit | 39bit         |8bit   | 8bit|  8bit      | 

说明:
* 采用ip后三位: 保证id在不同的实例生成不一样,这里也可以用每个实例机器编号
* 库号: 256个库
* 自增序列: 毫秒级 256,也就是每秒最多生成256000个
* 毫秒级时间差:为什么是时间差？这样id生成器存活更长的时间,比如我们可以选择从2020-01-01(1577808000000)开始计算
来我们算算该生成器规则能用多长时间:
39位最大数为 ~(-1<<39) = 549755813887 (二进制39位:111111111111111111111111111111111111111)
计算年数为  549755813887/3600/24/365/1000 = 17.43 可以用17年
以上分配位数可以根据业务实际情况调整。

## 4、Java代码实现ID生成器工具类

```java
package com.bytearch.sequence.util;

/**
 * 唯一id生成器
 * 1bit + 39bit时间差 + 8bit机器号 + 8bit用户编号(库号) + 8bit自增序列
 *
 * @author yarw  www.bytearch.com
 */
public final class SeqIdUtil {
    /**
     * 毫秒级开始时间 2020-01-01   时间差 = 当前时间 - MillisecondStartTime
     */
    private static final long MILLISECOND_START_TIME = 1577808000000L;

    /**
     * 时间差所占位数
     */
    private final long timeBits = 39L;
    /**
     * 机器Id所占位数
     **/
    private final static long WORKER_ID_BITS = 8L;

    /**
     * 用户指定编号(比如库号)位数
     */
    private final static long EXTRA_BITS = 8L;

    /**
     * 唯一序列位数
     */
    private static final long SN_BITS = 8L;

    private static final long MAX_SN = ~(-1L << SN_BITS);

    /**
     * 最多的机器id数
     */
    private final static long MAX_WORKER_ID = ~(-1L << WORKER_ID_BITS);

    private final static long MAX_EXTRA_ID = ~(-1L << EXTRA_BITS);

    /**
     * 毫秒内序列(0~4095)
     */
    private static long sequence = 0L;

    /**
     * 上次生成ID的时间截
     */
    private static long lastTimestamp = -1L;

    private static int ipSuffix = 0;

    static {
        //获取ip后三位
        ipSuffix = IpUtil.getIpSuffix();
    }

    /**
     * 自动获取机器编号-- 获取唯一ID
     *
     * @param extraId
     * @return
     */
    public static long nextId(long extraId) {
        return nextId(ipSuffix, extraId);
    }

    /**
     * 指定机器编号获取唯一Id
     *
     * @param workerId 机器编号
     * @param extraId  用户标识
     * @return
     */
    public static long nextId(long workerId, long extraId) {
        if (workerId > MAX_WORKER_ID || workerId < 0) {
            throw new IllegalArgumentException(String.format("workerId:%d invalid,  Its range is 0 to %d", workerId, MAX_WORKER_ID));
        }
        if (extraId > MAX_EXTRA_ID || extraId < 0) {
            throw new IllegalArgumentException(String.format("extraId:%d invalid,  Its range is 0 to %d", extraId, MAX_EXTRA_ID));
        }
        synchronized (SeqIdUtil.class) {
            long timestamp = timeGen();
            //如果当前时间小于上一次ID生成的时间戳，说明系统时钟回退过这个时候应当抛出异常
            if (timestamp < lastTimestamp) {
                throw new RuntimeException(String.format("clock moved backwards, Refusing to generate id for %d milliseconds", lastTimestamp - timestamp));
            }
            if (lastTimestamp == timestamp) {
                sequence = (sequence + 1) & MAX_SN;
                if (sequence == 0) {
                    timestamp = nextMillis(lastTimestamp);
                }
            } else {
                sequence = 0L;
            }
            lastTimestamp = timestamp;
            return (timestamp - MILLISECOND_START_TIME) << (SN_BITS + EXTRA_BITS + WORKER_ID_BITS)
                    | workerId << (SN_BITS + EXTRA_BITS)
                    | extraId << SN_BITS
                    | sequence;
        }
    }

    /**
     * 反解id
     *
     * @param id
     * @return
     */
    public static IdEntity decodeId(long id) {
        IdEntity idEntity = new IdEntity();
        idEntity.setSequenceId(id & MAX_SN);
        idEntity.setExtraId((id >> SN_BITS) & MAX_EXTRA_ID);
        idEntity.setWorkerId((id >> (SN_BITS + EXTRA_BITS)) & MAX_WORKER_ID);
        idEntity.setCreateTime((id >> (SN_BITS + EXTRA_BITS + WORKER_ID_BITS)) + MILLISECOND_START_TIME);
        return idEntity;
    }

    /**
     * 返回以毫秒为单位的当前时间
     *
     * @return 当前时间(毫秒)
     */
    private static long timeGen() {
        return System.currentTimeMillis();
    }

    /**
     * 阻塞到下一个毫秒，直到获得新的时间戳
     *
     * @param lastTimestamp 上次生成ID的时间截
     * @return 当前时间戳
     */
    private static long nextMillis(long lastTimestamp) {
        long timestamp = timeGen();
        while (timestamp <= lastTimestamp) {
            timestamp = timeGen();
        }
        return timestamp;
    }


    public static void main(String[] args) {
        long id = nextId(123);
        System.out.println("生成的id为:" + id);
        IdEntity idEntity = decodeId(id);
        System.out.println("解析id为:" + idEntity);
    }

}
```
其中IdEntity为id反解实体
```java
package com.bytearch.sequence.util;

/**
 * @author yarw
 */
public class IdEntity {
    private long createTime;
    private long workerId;
    private long extraId;
    private long sequenceId;

    public long getCreateTime() {
        return createTime;
    }

    public void setCreateTime(long createTime) {
        this.createTime = createTime;
    }

    public long getWorkerId() {
        return workerId;
    }

    public void setWorkerId(long workerId) {
        this.workerId = workerId;
    }

    public long getExtraId() {
        return extraId;
    }

    public void setExtraId(long extraId) {
        this.extraId = extraId;
    }

    public long getSequenceId() {
        return sequenceId;
    }

    public void setSequenceId(long sequenceId) {
        this.sequenceId = sequenceId;
    }

    @Override
    public String toString() {
        return "IpEntity{" +
                "createTime=" + createTime +
                ", workerId=" + workerId +
                ", extraId=" + extraId +
                ", sequenceId=" + sequenceId +
                '}';
    }
}
```
* 测试结果
```
生成的id为:187611327051168512
解析id为:IdEntity{createTime=1588990506504, workerId=185, extraId=123, sequenceId=0}
```
## 5、总结
   以上我们讨论了唯一id生成器大致思路和最佳实践,实际场景中可能还得结合业务,对机器号,用户标识,自增序列调整。
例如有的场景不需要用户标识,却需要很大的QPS,那么可以将用户标识省略,扩大自增序列(自增序列增加1bit可只支持最大QPS增长一倍).    

