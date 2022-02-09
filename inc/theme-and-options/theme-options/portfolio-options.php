<?php
//portfolio Page Options
CSF::createSection($restlyThemeOption, array(
    'title'  => esc_html__('Portfolio Page', 'restly'),
    'icon'   => 'fa fa-th-large',
    'fields' => array(
        array(
            'id'       => 'restly_portfolio_banner_enable',
            'type'     => 'switcher',
            'title'    => esc_html__('Enable Banner', 'restly'),
            'default'  => true,
            'text_on'  => esc_html__('Yes', 'restly'),
            'text_off' => esc_html__('No', 'restly'),
            'desc'     => esc_html__('Hide / Show Banner.', 'restly'),
        ),
        array(
            'id'         => 'restly_portfolio_related',
            'type'       => 'switcher',
            'title'      => esc_html__('Show Related Project', 'restly'),
            'default'    => true,
            'text_on'    => esc_html__('Yes', 'restly'),
            'text_off'   => esc_html__('No', 'restly'),
            'desc'       => esc_html__('Hide / Show Related Project.', 'restly'),
        ),
        array(
            'id'         => 'restly_portfolio_related_title',
            'type'       => 'text',
            'title'      => esc_html__('Related Title', 'restly'),
            'default'    => esc_html('Related Project','restly'),
            'dependency' => array( 'restly_portfolio_related', '==', 'true' ),
        ),
    )
));