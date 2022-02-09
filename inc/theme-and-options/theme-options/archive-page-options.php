<?php
//Archive Options
CSF::createSection($restlyThemeOption, array(
    'parent' => 'restly_page_options',
    'title'  => esc_html__('Archive Page', 'restly'),
    'icon'   => 'fa fa-archive',
    'fields' => array(
        array(
            'id'      => 'restly_archive_layout',
            'type'    => 'select',
            'title'   => esc_html__('Archive Layout', 'restly'),
            'options' => array(
                'grid'          => esc_html__('Grid Full', 'restly'),
                'grid-ls'       => esc_html__('Grid With Left Sidebar', 'restly'),
                'grid-rs'       => esc_html__('Grid With Right Sidebar', 'restly'),
                'left-sidebar'  => esc_html__('Left Sidebar', 'restly'),
                'right-sidebar' => esc_html__('Right Sidebar', 'restly'),
            ),
            'default' => 'right-sidebar',
            'desc'    => esc_html__('Select blog page layout.', 'restly'),
        ),
        array(
            'id'       => 'restly_archive_banner',
            'type'     => 'switcher',
            'title'    => esc_html__('Enable Archive Banner', 'restly'),
            'default'  => true,
            'text_on'  => esc_html__('Yes', 'restly'),
            'text_off' => esc_html__('No', 'restly'),
            'desc'     => esc_html__('Enable or disable archive page banner.', 'restly'),
        ),
        array(
            'id'       => 'restly_archive_pagination',
            'type'     => 'switcher',
            'title'    => esc_html__('Enable Archive Pagination', 'restly'),
            'default'  => true,
            'text_on'  => esc_html__('Yes', 'restly'),
            'text_off' => esc_html__('No', 'restly'),
            'desc'     => esc_html__('Enable or disable archive Pagination.', 'restly'),
        ),
        array(
            'id'     => 'restly_archive_banner_title_static_color',
            'type'   => 'color',
            'title'  => esc_html__( 'Banner Static Title Color', 'restly' ),
            'output' => '.page-header .container h2.archive-title',
            'dependency' => array('restly_archive_banner', '==', true),
            'desc'        => esc_html__('Select banner Static title color.', 'restly'),
        ),
        array(
            'id'     => 'restly_archive_banner_title_color',
            'type'   => 'color',
            'title'  => esc_html__( 'Banner Title Color', 'restly' ),
            'output' => '.archive-title span',
            'dependency' => array('restly_archive_banner', '==', true),
            'desc'        => esc_html__('Select banner title color.', 'restly'),
        ),
    )
));