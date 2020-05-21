module.exports = {
    title: 'BYTEARCH',
    //theme: '@vuepress/blog',
    theme: require.resolve('./theme'),
    themeConfig: {
        dateFormat: 'YYYY-MM-DD',
        docsDir: 'docs',
        docsBranch: 'master',
        nav: [
            {text: '首页', link: '/'},
            {text: '标签', link: '/tag/'},
            {text: '关于我', link: '/about'},
            {text: 'GitHub', link: 'https://www.github.com/bytearch'},

        ],
        footer: {
            contact: [
                {
                    type: 'github',
                    link: 'https://github.com/bytearch/blog',
                },
            ],
            copyright: [
                {
                    text: 'Copyright © 2020 浅谈架构 | 京ICP备20016259号-1',
                    link: 'http://www.bytearch.com',
                },
            ]
        },
        directories: [
            {
                id: 'post',
                dirname: 'post',
                path: '/',
            },
        ],
        globalPagination: {
            prevText: '上一页', // Text for previous links.
            nextText: '下一页', // Text for next links.
            lengthPerPage: '5', // Maximum number of posts per page.
            layout: 'Pagination', // Layout for pagination page
        },
        smoothScroll: true,
        summary: true,
    },
    plugins: [
        ['@vuepress/search', {
            searchMaxSuggestions: 5
        }]
    ]
}