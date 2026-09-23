const port = '4817'

const toolPage =
    '<html><body><h1>Zorblax CLI</h1>'
    + `<p>Install it with <code>cargo install zorblax</code>. The default port is ${port}.</p>`
    + '</body></html>'

const serveFixtures = () =>
    Bun.serve({
        port: 0,
        fetch: request => {
            const {pathname} = new URL(request.url)

            if (pathname === '/tool')
                return new Response(toolPage, {headers: {'content-type': 'text/html'}})
            return new Response('gone', {status: 404})
        }
    })

export {port, serveFixtures}
