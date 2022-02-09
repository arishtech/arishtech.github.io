<?php

//Banner Options
CSF::createSection($restlyThemeOption, array(
    'parent' => 'restly_page_options',
    'title'  => esc_html__('Banner / Breadcrumb Area', 'restly'),
    'icon'   => 'fa fa-flag',
    'fields' => array(


        array(
            'id'                    => 'restly_banner_default_options',
            'type'                  => 'background',
            'title'                 => esc_html__('Banner Background', 'restly'),
            'background_gradient'   => true,
            'background_origin'     => false,
            'background_clip'       => false,
            'background_blend-mode' => false,
            'default'               => array(
                'background-color'              => '',
                'background-gradient-color'     => '',
                'background-gradient-direction' => 'to right',
                'background-size'               => 'cover',
                'background-position'           => 'center center',
                'background-repeat'             => 'no-repeat',
            ),
            'output'                => '.breadcroumb-area',
            'subtitle'              => esc_html__('Select banner default properties for all page / post. You can override this settings on individual page / post.', 'restly'),
            'desc'                  => esc_html__('If you use gradient background color (Second Color) then background image will not working. Gradient background priority is higher then background image', 'restly'),
        ),
        array(
            'id'       => 'restly_breadcrumb_normal_color',
            'type'     => 'color',
            'title'    => esc_html__('Breadcrumb Text Color', 'restly'),
            'output'   => '.bre-sub span.current-item',
            'subtitle' => esc_html__('Breadcrumb Text Color', 'restly'),
            'desc'     => esc_html__('Select breadcrumb text color.', 'restly'),
        ),
        array(
            'id'       => 'restly_breadcrumb_link_color',
            'type'     => 'link_color',
            'title'    => esc_html__('Breadcrumb Link Color', 'restly'),
            'output'   => array('.bre-sub span a span'),
            'subtitle' => esc_html__('Breadcrumb Link color', 'restly'),
            'desc'     => esc_html__('Select breadcrumb link and link hover color.', 'restly'),
        ),
        array(
            'id'          => 'restly_breadcrumb_spacing',
            'type'        => 'spacing',
            'title'       => esc_html__('Breadcrumb Spacing', 'restly'),
            'subtitle'       => esc_html__('Add Breadcrumb Content Spacing', 'restly'),
            'output'      => '.breadcroumb-area',
            'output_mode' => 'padding', // or margin, relative
        ),
    )
));