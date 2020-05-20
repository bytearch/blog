# openresty源码安装教程

## 1. 下载源代码

```shell
wget https://github.com/openresty/openresty/releases/download/v1.15.8.3/openresty-1.15.8.3.tar.gz
##解压
tar -zxf openresty-1.15.8.3.tar.gz 
##进入安装目录
cd openresty-1.15.8.3
```

## 2.编译前准备

openresty依赖openssl,pcre库，没有安装的话需要安装一下

```shell
##Mac系统安装如下
brew install pcre openssl luajit
```

## 3 .编译安装

```shell
./configure    --with-cc-opt="-I/usr/local/opt/openssl/include/ -I/usr/local/opt/pcre/include/ -I/usr/local/opt/luajit/include"    --with-ld-opt="-L/usr/local/opt/openssl/lib/ -L/usr/local/opt/pcre/lib/ -L/usr/local/opt/luajit/lib"    -j8
make && make install
```

## 4. 加入环境变量

openresty默认安装在/usr/local/openresty目录(也可以在编译的时候--prefix指定路径)

```shell
#加入环境变量
vim ~/.bash_profile
PATH=/usr/local/openresty/bin:$PATH:.
export PATH
source ~/.bash_profile

##执行openresty -V 可以看到默认安装的模块
yarw@yarw openresty-1.15.8.3$ openresty -V
nginx version: openresty/1.15.8.3
built by clang 10.0.0 (clang-1000.10.44.4)
built with OpenSSL 1.0.2s  28 May 2019
TLS SNI support enabled
configure arguments: --prefix=/usr/local/openresty/nginx --with-cc-opt='-O2 -I/usr/local/opt/openssl/include/ -I/usr/local/opt/pcre/include/ -I/usr/local/opt/luajit/include' --add-module=../ngx_devel_kit-0.3.1rc1 --add-module=../echo-nginx-module-0.61 --add-module=../xss-nginx-module-0.06 --add-module=../ngx_coolkit-0.2 --add-module=../set-misc-nginx-module-0.32 --add-module=../form-input-nginx-module-0.12 --add-module=../encrypted-session-nginx-module-0.08 --add-module=../srcache-nginx-module-0.31 --add-module=../ngx_lua-0.10.15 --add-module=../ngx_lua_upstream-0.07 --add-module=../headers-more-nginx-module-0.33 --add-module=../array-var-nginx-module-0.05 --add-module=../memc-nginx-module-0.19 --add-module=../redis2-nginx-module-0.15 --add-module=../redis-nginx-module-0.3.7 --add-module=../rds-json-nginx-module-0.15 --add-module=../rds-csv-nginx-module-0.09 --add-module=../ngx_stream_lua-0.0.7 --with-ld-opt='-Wl,-rpath,/usr/local/openresty/luajit/lib -L/usr/local/opt/openssl/lib/ -L/usr/local/opt/pcre/lib/ -L/usr/local/opt/luajit/lib' --with-stream --with-stream_ssl_module --with-stream_ssl_preread_module --with-http_ssl_module
```

## 5.启动openresty

```shell
openresty -c /usr/local/openresty/nginx/conf/nginx.conf
##执行curl请求 可以看到安装成功
yarw@yarw openresty-1.15.8.3$ curl http://localhost/
<!DOCTYPE html>
<html>
<head>
<title>Welcome to OpenResty!</title>
<style>
    body {
        width: 35em;
        margin: 0 auto;
        font-family: Tahoma, Verdana, Arial, sans-serif;
    }
</style>
</head>
<body>
<h1>Welcome to OpenResty!</h1>
<p>If you see this page, the OpenResty web platform is successfully installed and
working. Further configuration is required.</p>

<p>For online documentation and support please refer to
<a href="https://openresty.org/">openresty.org</a>.<br/>
Commercial support is available at
<a href="https://openresty.com/">openresty.com</a>.</p>

<p><em>Thank you for flying OpenResty.</em></p>
</body>
</html>
```

