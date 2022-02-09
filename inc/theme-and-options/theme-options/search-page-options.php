<?php
//search Options
CSF::createSection($restlyThemeOption, array(
    'parent' => 'restly_page_options',
    'title'  => esc_html__('Search Page', 'restly'),
    'icon'   => 'fa fa-search',
    'fields' => array(
        array(
            'id'      => 'restly_search_layout',
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
            'id'       => 'restly_search_banner',
            'type'     => 'switcher',
            'title'    => esc_html__('Enable search Banner', 'restly'),
            'default'  => true,
            'text_on'  => esc_html__('Yes', 'restly'),
            'text_off' => esc_html__('No', 'restly'),
            'desc'     => esc_html__('Enable or disable search page banner.', 'restly'),
        ),
        
    )
));