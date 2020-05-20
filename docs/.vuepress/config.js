module.exports = {
    title: '浅谈架构',
    description: '分享技术、所见、所闻、所感',
    themeConfig: {
        docsDir: 'docs',
        nav: [
            {text: '首页', link: '/'},
            {text: '归档', link: '/summary'},
            {
                text: '主题',
                items: [
                    {text: "系统重构", link: '/theme/restruct'}
                ]
            },
            {text: '关于我', link: '/about'},
            {text: 'GitHub', link: 'https://www.github.com/bytearch/blog'},
        ],
        logo: 'http://storage.bytearch.com/images/demo.jpeg',
        sidebarDepth: 3,
        sidebar: {
            '/theme/': [
                {
                    title: "千万级系统重构",
                    collapsable: false,
                    children: [
                        "/theme/restruct.md",
                        "/theme/openresty_proxy.md",
                        "/theme/sequenceId.md",
                        "/theme/mysql_shard.md",
                    ]
                }

            ],
            '/summary/': [
                {
                    title: "归档", collapsable: false
                }
            ]

        }
    },

}