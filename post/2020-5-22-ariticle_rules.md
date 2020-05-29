---
title: 浅谈架构技术文章格式规约
date: 2020-05-22
tags: 
  - 规约
author: bytearch
location: Beijing  
summary: 技术文章书写规范约定
---

[[toc]]

### 1. 文件命名
YYYY-M-d-主题_名称
例如:写mysql分库分表文章命名

    2020-05-22-mysql_sharding
### 2. 备注
顶部添加备注格式(yaml格式)
例如：
```text
---
title: 浅谈mysql数据库分库分表那些事     //标题
date: 2020-05-17                      //日期
tags:                                 //标签
  - 系统重构系列
  - Java
  - 架构好文
author: bytearch                      //作者
location: Beijing                     //位置
summary: mysql水平分库分表落地方案 解决亿级数据存储问题  //文章简介
---
```
### 3. 添加文章toc
添加到备注下面
```text
[[toc]]
```

### 4. 正文
段落标题
```text
## 1. 标题
```
内容语法markdown语法