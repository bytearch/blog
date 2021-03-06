---
title: 浅谈系统重构之数据双向同步-理论篇
date: 2020-05-26
tags: 
  - Java
  - 浅谈千万级系统重构
  - 架构好文
author: bytearch
location: Beijing  
summary: ​ 对于系统重构,入口层采用nginx+lua流量控制模块控制新老系统转发,那么如何保证如果有问题,可以立马切换到老系统,而保证数据没问题。 显然,我们得保证新老系统DB层数据完全一样。新系统产生的数据实时同步到老系统,同理老系统同步到新系统！今天我们就来聊聊数据双向同步。
     
---
[[toc]]

### 1. 前言

 对于系统重构平滑迁移,入口层采用nginx+lua流量控制模块控制新老系统转发,那么如何保证如果有问题,可以立马切换到老系统,而保证数据没问题. 显然,我们得保证新老系统DB层数据完全一样。新系统产生的数据实时同步到老系统，老系统产生的数据实时同步到新系统！今天我们就来聊聊数据双向同步。
 ​         ![old->new](images/new_old.jpg)

### 2. 思路

  1) 逻辑层直接写入DB

该方式最简单,但是, 改方式有如下缺点:

* 性能有所影响, 
* 系统重构老系统往往写入口很多,可能需要大量改之前的代码, 老->新不太合适

当然, 也可以通过插件的方式(例如mybatis插件)拦截insert, update 

  2) 逻辑层先写入MQ, 消费MQ异步写入
  
   该方式其实和1)类似,，但是需要特别注意的是,需要保证顺序(想想如果update跑到insert前面去了会怎么样？)

* 入队列进入同一个队列: 一般来说,数据会有唯一标识,如订单系统有订单Id，我们可以将同一个订单Id放入同一个队列。

* 消费端采用顺序消费:  例如RocketMq Consumer使用MessageListenerOrderly类顺序消费
   ![a_to_b](images/mq_A_to_B.jpg)
 
  3) “伪装“成从库, 解析binlog实时同步到mysql
   开源数据同步神器-canal
  ![canal](images/canal.png)
  相关请文档查看: https://github.com/alibaba/canal  
  
### 3.注意事项

1). 数据同步延时问题
在入口层(灰度模块)判断,新系统产生的订单走新系统, 老系统产生的订单走老系统
> 注: 生成的订单就能区分新老系统, 比如老系统订单表主键(订单id)是自增(int型)， 新订单是long型,我们可以通过长度区分新老订单

2). 回环问题
新系统产生的数据同步到老系统, 不能又流回到新系统，反之也一样。
对于MQ同步方式,可以分不同的topic,业务逻辑层就直接能够知道数据来源。
对于canal同步,可以参考: https://github.com/alibaba/otter/wiki/QuickStart
  
  
  
  
  
  
  
  
  
  
  

















​       