---
title: 浅谈轻量级socket连接池实现
date: 2020-04-20
tags: 
  - Java
  - 实战案例
author: bytearch
location: Beijing  
summary: ​开源轻量级分布式文件系统Fastdfs Java-SDK的改造,主要是增加socket连接池功能
---

## 1. 背景

​	前段时间有幸参与到开源轻量级分布式文件系统Fastdfs Java-SDK的改造,主要是增加socket连接池功能

​    支持连接池和短连接两种方式,是否开启连接池可选(默认开启),短连接(用完即关闭)

## 2. 如何实现

​    调研了连接池下,网上很多socket连接池都是用Apache Commons Pool来实现的,个人感觉可能有点重,所以就完全原生代码实现连接池开发了。

## 3. 实现代码

* socket连接类

  ```java
  public class Connection {
  
      private Socket sock;
      private InetSocketAddress inetSockAddr;
      private Long lastAccessTime = System.currentTimeMillis();
      private boolean needActiveTest = false;
  
      public Connection(Socket sock, InetSocketAddress inetSockAddr) {
          this.sock = sock;
          this.inetSockAddr = inetSockAddr;
      }
  
      /**
       * get the server info
       *
       * @return the server info
       */
      public InetSocketAddress getInetSocketAddress() {
          return this.inetSockAddr;
      }
  
      public OutputStream getOutputStream() throws IOException {
          return this.sock.getOutputStream();
      }
  
      public InputStream getInputStream() throws IOException {
          return this.sock.getInputStream();
      }
  
      public Long getLastAccessTime() {
          return lastAccessTime;
      }
  
      public void setLastAccessTime(Long lastAccessTime) {
          this.lastAccessTime = lastAccessTime;
      }
  
      /**
       *
       * @throws IOException
       */
      public void close() throws IOException {
          //if connection enabled get from connection pool
          if (ClientGlobal.g_connection_pool_enabled) {
              ConnectionPool.closeConnection(this);
          } else {
              this.closeDirectly();
          }
      }
  
      public void release() throws IOException {
          if (ClientGlobal.g_connection_pool_enabled) {
              ConnectionPool.releaseConnection(this);
          } else {
              this.closeDirectly();
          }
      }
  
      /**
       * force close socket,
       */
      public void closeDirectly() throws IOException {
          if (this.sock != null) {
              try {
                  ProtoCommon.closeSocket(this.sock);
              } finally {
                  this.sock = null;
              }
          }
      }
  
      public boolean activeTest() throws IOException {
          if (this.sock == null) {
              return false;
          }
          return ProtoCommon.activeTest(this.sock);
      }
  
      public boolean isConnected() {
          boolean isConnected = false;
          if (sock != null) {
              if (sock.isConnected()) {
                  isConnected = true;
              }
          }
          return isConnected;
      }
      public boolean isAvaliable() {
          if (isConnected()) {
              if (sock.getPort() == 0) {
                  return false;
              }
              if (sock.getInetAddress() == null) {
                  return false;
              }
              if (sock.getRemoteSocketAddress() == null) {
                  return false;
              }
              if (sock.isInputShutdown()) {
                  return false;
              }
              if (sock.isOutputShutdown()) {
                  return false;
              }
              return true;
          }
          return false;
      }
  
      public boolean isNeedActiveTest() {
          return needActiveTest;
      }
  
      public void setNeedActiveTest(boolean needActiveTest) {
          this.needActiveTest = needActiveTest;
      }
  }
  ```

  

* 连接管理器(主要职责:获取连接，关闭连接，释放连接)

```java
public class ConnectionManager {

    private InetSocketAddress inetSocketAddress;

    /**
     * count of total connections 
     */
    private AtomicInteger totalCount = new AtomicInteger();

    /**
     * count of free connections
     */
    private AtomicInteger freeCount = new AtomicInteger();

    /**
     * lock
     */
    private ReentrantLock lock = new ReentrantLock(true);

    private Condition condition = lock.newCondition();

    /**
     * free container connection  
     */
    private LinkedList<Connection> freeConnections = new LinkedList<Connection>();

    private ConnectionManager() {

    }

    public ConnectionManager(InetSocketAddress socketAddress) {
        this.inetSocketAddress = socketAddress;
    }

   /**
    * get connection
    **/
    public Connection getConnection() throws MyException {
        lock.lock();
        try {
            Connection connection = null;
            while (true) {
                if (freeCount.get() > 0) {
                    freeCount.decrementAndGet();
                    connection = freeConnections.poll();
                    if (!connection.isAvaliable() || (System.currentTimeMillis() - connection.getLastAccessTime()) > ClientGlobal.g_connection_pool_max_idle_time) {
                        closeConnection(connection);
                        continue;
                    }
                    if (connection.isNeedActiveTest()) {
                        boolean isActive = false;
                        try {
                            isActive = connection.activeTest();
                        } catch (IOException e) {
                            System.err.println("send to server[" + inetSocketAddress.getAddress().getHostAddress() + ":" + inetSocketAddress.getPort() + "] active test fail ,emsg:" + e.getMessage());
                            isActive = false;
                        }
                        if (!isActive) {
                            closeConnection(connection);
                            continue;
                        } else {
                            connection.setNeedActiveTest(false);
                        }
                    }
                } else if (ClientGlobal.g_connection_pool_max_count_per_entry == 0 || totalCount.get() < ClientGlobal.g_connection_pool_max_count_per_entry) {
                    connection = ConnectionFactory.create(this.inetSocketAddress);
                    totalCount.incrementAndGet();
                } else {
                    try {
                        if (condition.await(ClientGlobal.g_connection_pool_max_wait_time_in_ms, TimeUnit.MILLISECONDS)) {
                            //wait single success
                            continue;
                        }
                        throw new MyException("connect to server " + inetSocketAddress.getAddress().getHostAddress() + ":" + inetSocketAddress.getPort() + " fail, wait_time > " + ClientGlobal.g_connection_pool_max_wait_time_in_ms + "ms");
                    } catch (InterruptedException e) {
                        e.printStackTrace();
                        throw new MyException("connect to server " + inetSocketAddress.getAddress().getHostAddress() + ":" + inetSocketAddress.getPort() + " fail, emsg:" + e.getMessage());
                    }
                }
                return connection;
            }
        } finally {
            lock.unlock();
        }
    }

   /**
   *release connection
   */
    public void releaseConnection(Connection connection) {
        if (connection == null) {
            return;
        }
        lock.lock();
        try {
            connection.setLastAccessTime(System.currentTimeMillis());
            freeConnections.add(connection);
            freeCount.incrementAndGet();
            condition.signal();
        } finally {
            lock.unlock();
        }

    }

    /**
     *close connection
     *
     */
    public void closeConnection(Connection connection) {
        try {
            if (connection != null) {
                totalCount.decrementAndGet();
                connection.closeDirectly();
            }
        } catch (IOException e) {
            System.err.println("close socket[" + inetSocketAddress.getAddress().getHostAddress() + ":" + inetSocketAddress.getPort() + "] error ,emsg:" + e.getMessage());
            e.printStackTrace();
        }
    }

    public void setActiveTestFlag() {
        if (freeCount.get() > 0) {
            lock.lock();
            try {
                for (Connection freeConnection : freeConnections) {
                    freeConnection.setNeedActiveTest(true);
                }
            } finally {
                lock.unlock();
            }
        }
    }

}
```

​		注:其中setActiveTestFlag()方法解释一下,有可能出现连接断了之后，可能是这台服务器重启了，或者网络抽风导致闪断。希望只牺牲一次请求,主要解决服务器重启问题

大致思路就是一旦client请求时一旦有连接出现IOException,就会将所有当前实例对应的所有连接全部变为需要activeTest,当下一个连接获取时,就会检测所有的连接,从而达到只牺牲一次请求的目的.



* 管理器连接池(由于存在多个实例,一个实例对应一个ConnectionManager,连接获取,释放,关闭的入口)

```java
public class ConnectionPool {
    /**
     * key is ip:port, value is ConnectionManager
     */
    private final static ConcurrentHashMap<String, ConnectionManager> CP = new ConcurrentHashMap<String, ConnectionManager>();

    public static Connection getConnection(InetSocketAddress socketAddress) throws MyException {
        if (socketAddress == null) {
            return null;
        }
        String key = getKey(socketAddress);
        ConnectionManager connectionManager;
        connectionManager = CP.get(key);
        if (connectionManager == null) {
            synchronized (ConnectionPool.class) {
                connectionManager = CP.get(key);
                if (connectionManager == null) {
                    connectionManager = new ConnectionManager(socketAddress);
                    CP.put(key, connectionManager);
                }
            }
        }
        return connectionManager.getConnection();
    }

    public static void releaseConnection(Connection connection) throws IOException {
        if (connection == null) {
            return;
        }
        String key = getKey(connection.getInetSocketAddress());
        ConnectionManager connectionManager = CP.get(key);
        if (connectionManager != null) {
            connectionManager.releaseConnection(connection);
        } else {
            connection.closeDirectly();
        }

    }

    public static void closeConnection(Connection connection) throws IOException {
        if (connection == null) {
            return;
        }
        String key = getKey(connection.getInetSocketAddress());
        ConnectionManager connectionManager = CP.get(key);
        if (connectionManager != null) {
            connectionManager.closeConnection(connection);
            connectionManager.setActiveTestFlag();
        } else {
            connection.closeDirectly();
        }
    }

    private static String getKey(InetSocketAddress socketAddress) {
        if (socketAddress == null) {
            return null;
        }
        return String.format("%s:%s", socketAddress.getAddress().getHostAddress(), socketAddress.getPort());
 }
```

以上代码已发布于fastdfs-client-java [V1.28](https://github.com/happyfish100/fastdfs-client-java/releases/tag/V1.28)版本

更多具体实现及源码请查看:https://github.com/happyfish100/fastdfs-client-java/tree/master/src/main/java/org/csource/fastdfs/pool

