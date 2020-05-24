---
title: 聊一聊扩展字段设计
date: 2020-04-23
tags: 
  - Java
  - 架构好文
author: bytearch
location: Beijing  
summary: ​工作中我们常常有需求需要加字段,如果数据库数据量比较大,新增字段耗时较长,导致性能下降，甚至出现锁表等问题。       
---
[[toc]]


### 1. 背景

​		工作中我们常常有需求需要加字段,如果数据库数据量比较大,新增字段耗时较长,导致性能下降，甚至出现锁表等问题。
​     添加扩展字段, 常见的做法有,
 * 动态添加字段
 * 添加扩展表
 * json方式存储
 * xml方式存储
  
  这里我们聊聊基于*KV行存储*和基于*按位存储*。

###  2. 基于KV水平存储

场景:例如现在有张订单表,需要新增field_1,field_2 字段,并且以后可能会无限扩展字段

* kv表结构设计

```sql
CREATE TABLE `kv` (
  `id` bigint(20) NOT NULL,
  `key` varchar(30) NOT NULL COMMENT '存储字段名',
  `value` varchar(3000) NOT NULL DEFAULT '' COMMENT '存储value',
  `create_time` timestamp NULL DEFAULT NULL COMMENT '创建时间',
  `type` tinyint(4) NOT NULL DEFAULT '1' COMMENT '字段类型: 1: string , 2: json',
  PRIMARY KEY (`id`, `key`),
  KEY `idx_create_time` (`create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='扩展字段KV表';
```

*注 :实际场景中会对kv表进行分表/分库, 因为都是id维度,可以按照id 取hash 分表/分库*

* 代码改造如下

```java
        //1. 从配置中心获取参数key(这里我就直接写死了)
        String fieldKeys = "field_a,field_b";
        List<String> fieldKeyArr = Splitter.on(",").trimResults().omitEmptyStrings().splitToList(fieldKeys);
        //2. 从request中获取需要存储param
        if (CollectionUtils.isEmpty(fieldKeyArr)) {
            return;
        }
        //3. 获取request中的参数
        HttpServletRequest request = ((ServletRequestAttributes) RequestContextHolder.getRequestAttributes()).getRequest();
        for (String key : fieldKeyArr) {
            String value = request.getParameter(key);
            if (StringUtils.isEmpty(value)) {
                continue;
            }
            //4组装扩展字段 
        }
        //5 存储扩展字段
```

* 打通查询接口

查询语句如下:

```sql
SELECT  key,value FROM order_KV where order_id = {order_id} and key in('field_a','field_b')
```

查询接口我们可以新增返回字段Map(String,String) extData,将扩展字段以map的方式返回,以后新增字段就无需改代码了,只需更改配置中心配置即可。

### 3. 基于按位存储设计

 适合场景: 我们经常会有新增字段,并且字段类型为布尔(只有0和1)的场景

 实现思路: 可以新增一个flag(Long型,64位)字段, 由于二进制位只有0和1,所以我们可以利用这个特性来标识只有0和1场景的字段，最多可以表示64个字段。

​    实现方式如下

* 首先定义一个flag实体,定义标志key 和位置

```java
@Data
public class FlagBO {
    @Attribute(name = "key", required = true)
    private String key;
    @Attribute(name = "position", required = true)
    private Byte position;

    public Long getHexLong() {
        if (position <= 64) {
            return (long) Math.pow(2, position -1);//2的n-1次方 二进制位 01 10 100 1000
        }
        return 0L;
    }
}
```

* 定义字段枚举(这里也可以从配置中心定义)

```java
/**
	<!-- 标志位表 一旦设置 不能更改 --> 
  <!-- 注意需要按照规律设置值固定 设置范围 1<= X <= 64  建议按照顺序设置 --> 
*/
public enum OrderFlagEnum {
    orderFieldBooleanA("orderFieldBooleanA", (byte) 1),
    orderFieldBooleanB("orderFieldBooleanB", (byte) 2);
    private String key;
    private Byte position;

    OrderFlagEnum(String key, Byte position) {
        this.key = key;
        this.position = position;
    }

    //获取flag定义列表
    public static List<FlagBO> getOrderFlagBO() {
        List<FlagBO> flagBOList = new ArrayList<>();
        for (OrderFlagEnum orderFlagEnum : OrderFlagEnum.values()) {
            FlagBO flagBO = new FlagBO();
            flagBO.setKey(orderFlagEnum.key);
            flagBO.setPosition(orderFlagEnum.position);
            flagBOList.add(flagBO);
        }
        return flagBOList;
    }
}
```

* 从请求参数中获取字段并且组装成flag

```java
  
    /**
     * encode flag
     *
     * @param request
     * @return
     */
    public Long getFlagFromRequest(HttpServletRequest request) {
        long flag = 0;
        //获取flag配置
        List<FlagBO> orderFlags = getOrderFlags();
        if (orderFlags != null && !orderFlags.isEmpty()) {
            for (FlagBO orderFlag : orderFlags) {
                String parameter = request.getParameter(orderFlag.getKey());
                if (StringUtils.isNumeric(parameter)) {
                    if (Integer.valueOf(parameter) == 0) {
                        continue;
                    }
                    flag = flag | orderFlag.getHexLong();
                }
            }
        }
        return flag;

    }
```

* 查询的时候我们只需要将flag反解出来即可
* 同样在查询接口可以添加至extData

```java
    /**
     * decode flag
     * @param flag
     */
    public Map<String, Object> decodeOrderFlag(Long flag) {
        Map<String, Object> flagMap = new HashMap<>();
        List<FlagBO> orderFlags = getOrderFlags();
        if (orderFlags != null && !orderFlags.isEmpty()) {
            for (FlagBO orderFlag : orderFlags) {
                if ((flag & orderFlag.getHexLong()) == orderFlag.getHexLong()) {
                    flagMap.put(orderFlag.getKey(), 1);
                } else {
                    flagMap.put(orderFlag.getKey(), 0);
                }
            }
        }
        return flagMap;
    }
```



*  实际运用中我们会遇到这样的场景,比如更新的时候可能同时有*添加*和*删除*的场景,如何处理？

* 我们可以将 添加 和 删除 操作分类为addFlag 和 subFlag

```java
 /**
     * 获取更新标志位
     * addFlag 新增
     * subFlag 删除
     * flagMap 中 value true 为添加 否则为删除
     * @param flagMap
     * @return
     */
    public flagUpdateBO getUpdateFlagBOByMap(Map<String, Integer> flagMap) {
        flagUpdateBO flagUpdateBO = new flagUpdateBO();
        Long addFlag = 0L;
        Long subFlag = 0L;
        Map<String, FlagBO> flagBOMap = getOrderFlagsMap();
        if (flagMap != null && !flagMap.isEmpty()) {
            for (Map.Entry<String, Integer> flagMapEntry : flagMap.entrySet()) {
                //存在
                FlagBO flagBO = flagBOMap.get(flagMapEntry.getKey());
                if (flagBO != null) {
                    if (flagMapEntry.getValue() != null && flagMapEntry.getValue() > 0) {
                        //add flag
                        addFlag = addFlag | flagBO.getHexLong();
                    } else {
                        subFlag = subFlag | flagBO.getHexLong();
                    }
                }
            }
        }
        flagUpdateBO.setAddFlag(addFlag);
        flagUpdateBO.setSubFlag(subFlag);
        return flagUpdateBO;
    }
```

最后更新的sql为:

```sql
update order_info set flag = (flag | #{addFlag}) & (~ #{subFlag})
```

​      

### 4. 总结

flag和kv对比如下

| 类型 | 适合规则             | 存储类型              |
| ---- | -------------------- | --------------------- |
| flag | 只有0和1两种值的情况 | 0和1                  |
| kv   | 可以任意值           | 可以存储string 和json |

相信以上方案可以解决工作上大部分添加字段的需求,如果还有其它比较好的方式欢迎与我探讨。

### 5、 欢迎关注"浅谈架构"公众号、不定期分享精彩文章

![浅谈架构](http://storage.bytearch.com/images/qrcode_demo_bytearch.jpg)

