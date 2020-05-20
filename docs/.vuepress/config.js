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
                    {text: "系统重构", link: '/theme/'}
                ]
            },
            {text: '关于我', link: '/about'},
            {text: 'GitHub', link: 'https://www.github.com/bytearch/blog'},
        ],
        logo: 'http://storage.bytearch.com/images/demo.jpeg',
        sidebarDepth: 3,
    },
    sidebar: {
        '/theme/': [
            '/theme/restruct',
            {
                title: "千万级系统重构",
                collapsable: false,
                children: [
                    "/theme/mysql_shard.md",
                    "/theme/sequenceId.md"
                ]
            }

        ],
        '/summary/': [
            {
                title: "归档", collapsable: false
            }
        ]

    }
}